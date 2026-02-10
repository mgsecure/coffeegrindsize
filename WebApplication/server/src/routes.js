import formidable from 'formidable';
import fs from 'fs';
import { analyzeImage } from './util/analysis.js';
import { logger } from './logger/logger.js';
import path from 'path';
import {fileURLToPath} from 'url'
import dayjs from 'dayjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
console.log(__dirname)
const resultsCacheDir = path.resolve(__dirname, 'resultsCache')

export function registerRoutes(app, { prefix }) {
  app.get(`${prefix}/ready`, (req, res) => {
    res.json({ status: 'ready' })
  })

  app.post(`${prefix}/analyze`, (req, res) => {

    const start = Date.now()

    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB
      multiples: true
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        logger.error(err, 'Error parsing form');
        res.status(500).json({ error: 'Error parsing form' });
        return;
      }

      const file = files.image?.[0] || files.image;
      if (!file) {
        res.status(400).json({ error: 'No image uploaded' });
        return;
      }

      try {
        // Log file information for debugging (support formidable variations)
        const resolvedPath = file.filepath || file.path || file.fileName || null;
        logger.info({ file: { name: file.originalFilename || file.name || null, size: file.size || null, resolvedPath } }, 'Received uploaded file');
        const uploadFileName = file.originalFilename || file.name || null;

        let buffer = null;
        // If formidable provided a path on disk, read it
        const candidatePath = resolvedPath || file.filepath || file.path;
        if (candidatePath) {
          try {
            buffer = fs.readFileSync(candidatePath);
            logger.info({ bufferLength: buffer.length, candidatePath }, 'Read uploaded file from disk');
          } catch (e) {
            logger.warn({ err: e.message, candidatePath }, 'Failed to read uploaded file from disk path');
            buffer = null;
          }
        }

        // If formidable/middleware provided the raw buffer in-memory, use it
        if (!buffer && (file.buffer || file.data)) {
          buffer = file.buffer || file.data;
          // Some libs give Uint8Array; convert to Buffer
          if (!(buffer instanceof Buffer)) buffer = Buffer.from(buffer);
          logger.info({ bufferLength: buffer.length, inMemory: true }, 'Using in-memory uploaded file buffer');
        }

        // Multer-like: files may be passed as a plain Buffer
        if (!buffer && Buffer.isBuffer(file)) {
          buffer = file;
          logger.info({ bufferLength: buffer.length }, 'File upload delivered as Buffer');
        }

        if (!buffer) {
          logger.error({ file }, 'Unable to resolve uploaded file contents');
          res.status(400).json({ error: 'Unable to read uploaded file' });
          return;
        }

        const getField = (f) => Array.isArray(f) ? f[0] : f;
        const options = {
          threshold: fields.threshold ? parseFloat(getField(fields.threshold)) : 58.8,
          brightness: fields.brightness ? parseFloat(getField(fields.brightness)) : 1.0,
          contrast: fields.contrast ? parseFloat(getField(fields.contrast)) : 1.0,
          maxClusterAxis: fields.maxClusterAxis ? parseFloat(getField(fields.maxClusterAxis)) : 5,
          minSurface: fields.minSurface ? parseFloat(getField(fields.minSurface)) : 0.05,
          maxSurface: fields.maxSurface ? parseFloat(getField(fields.maxSurface)) : 10,
          minRoundness: fields.minRoundness ? parseFloat(getField(fields.minRoundness)) : 0,
          referenceThreshold: fields.referenceThreshold ? parseFloat(getField(fields.referenceThreshold)) : 0.4,
          maxCost: fields.maxCost ? parseFloat(getField(fields.maxCost)) : 0.35,
          quick: getField(fields.quick) === 'true' || getField(fields.quick) === true || getField(fields.quick) === '1' || getField(fields.quick) === 1,
          referenceMode: getField(fields.referenceMode) || 'detected',
          debug: getField(fields.debug) === 'true' || getField(fields.debug) === true || getField(fields.debug) === '1' || getField(fields.debug) === 1
        };

        logger.info({ options }, 'Analyze options');

        // Call analyzeImage with a defensive try/catch to capture any server-side errors
        let results;
        try {
          results = await analyzeImage(buffer, options);
        } catch (err) {
          logger.error({ err: err.message, stack: err.stack }, 'analyzeImage threw an error');
          // Return stack in response for local debugging if SHOW_STACK=1 is set
          const resp = { error: 'Error during analysis', message: err.message };
          if (process.env.SHOW_STACK === '1') resp.stack = err.stack;
          res.status(500).json(resp);
           return;
         }

        const outputFilename = `${uploadFileName}_${dayjs().format( 'YYYYMMDD_HHmmss')}`;
        if (!fs.existsSync(resultsCacheDir)) {
          fs.mkdirSync(resultsCacheDir, { recursive: true });
        }
        const resultsCopy = { ...results }
        delete resultsCopy.thresholdImage
        delete resultsCopy.outlinesImage

        //fs.writeFileSync(path.join(resultsCacheDir, `${outputFilename}_results.json`), JSON.stringify(resultsCopy, null, 2), 'utf8')

        logger.info(['Done', results.particleCount, 'particles, time:', Date.now() - start, 'ms'].join(' '))

        res.json(results);



      } catch (error) {
         logger.error({ error: error.message, stack: error.stack }, 'Error during analysis');
         res.status(500).json({ error: 'Error during analysis', message: error.message });
       }
     });
   })
 }
