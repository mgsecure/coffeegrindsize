import formidable from 'formidable';
import fs from 'fs';
import { analyzeImage } from './util/analysis.js';
import { logger } from './logger/logger.js';

export function registerRoutes(app, { prefix }) {
  app.get(`${prefix}/ready`, (req, res) => {
    res.json({ status: 'ready' })
  })

  app.post(`${prefix}/analyze`, (req, res) => {
    const form = formidable({});

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

        const options = {
          threshold: fields.threshold ? parseFloat(fields.threshold) : 58.8,
          maxClusterAxis: fields.maxClusterAxis ? parseFloat(fields.maxClusterAxis) : 5,
          minSurface: fields.minSurface ? parseFloat(fields.minSurface) : 0.05,
          maxSurface: fields.maxSurface ? parseFloat(fields.maxSurface) : 10,
          minRoundness: fields.minRoundness ? parseFloat(fields.minRoundness) : 0,
          referenceThreshold: fields.referenceThreshold ? parseFloat(fields.referenceThreshold) : 0.4,
          maxCost: fields.maxCost ? parseFloat(fields.maxCost) : 0.35,
          quick: fields.quick === 'true' || fields.quick === true || fields.quick?.[0] === 'true',
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

        res.json(results);
       } catch (error) {
         logger.error({ error: error.message, stack: error.stack }, 'Error during analysis');
         res.status(500).json({ error: 'Error during analysis', message: error.message });
       }
     });
   })
 }
