import sharp from 'sharp';
import fs from 'fs';

async function test() {
  const buffer = fs.readFileSync('WebApplication/client/src/resources/circle-93mm.jpg');
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  const rawBlue = await image
    .extractChannel('blue')
    .raw()
    .toBuffer();

  const data = new Uint8Array(rawBlue);

  function calculateMedian(data) {
    const hist = new Int32Array(256);
    for (let i = 0; i < data.length; i++) hist[data[i]]++;
    let count = 0;
    const mid = data.length / 2;
    for (let i = 0; i < 256; i++) {
      count += hist[i];
      if (count >= mid) return i;
    }
    return 128;
  }

  const median = calculateMedian(data);
  console.log('Median:', median);

  // Use a lower threshold to find the dark circle
  const threshold = (median * 40) / 100;
  console.log('Threshold:', threshold);

  const visited = new Uint8Array(data.length);
  const candidates = [];

  for (let i = 0; i < data.length; i += 10) { // Sample to speed up
    if (data[i] < threshold && !visited[i]) {
      const cluster = [];
      const queue = [i];
      visited[i] = 1;
      let minX = i % width, maxX = i % width, minY = Math.floor(i / width), maxY = Math.floor(i / width);

      while (queue.length > 0) {
        const curr = queue.shift();
        cluster.push(curr);
        const x = curr % width;
        const y = Math.floor(curr / width);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;

        const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (data[nIdx] < threshold && !visited[nIdx]) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      const w = maxX - minX;
      const h = maxY - minY;
      const area = cluster.length;
      const extent = area / (w * h || 1);
      const aspectRatio = w / h;
      const circularity = (4 * Math.PI * area) / (Math.pow((w + h), 2)); // Approximation

      console.log(`Cluster found: Area=${area}, W=${w}, H=${h}, Extent=${extent.toFixed(3)}, AR=${aspectRatio.toFixed(3)}, Circularity=${circularity.toFixed(3)}`);
      
      if (w > 100 && h > 100) {
        candidates.push({ area, w, h, extent, aspectRatio, circularity });
      }
    }
  }
}

test().catch(console.error);
