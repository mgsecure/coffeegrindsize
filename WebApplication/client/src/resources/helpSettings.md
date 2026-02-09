## Settings

This section provides guidance on how to configure various settings within the application to ensure accurate particle analysis of your coffee grinds.

### Image Processing Settings

**Threshold (%)**
- **Function:** Determines the brightness cutoff for identifying coffee particles against the background.
- **Default:** 58.8%
- **Effect of Changing:** A lower threshold will be more selective, only picking up the darkest areas (potentially missing smaller or lighter particles). A higher threshold will be more inclusive, but may start to include shadows or background noise as particles.
- **Recommendations:** If you see "blobs" connecting particles in the Thresholded view, try lowering the value. If particles are missing, try increasing it.

**Brightness & Contrast**
- **Function:** Adjusts the image levels before analysis.
- **Default:** 1.0 (no change)
- **Effect of Changing:** Increasing brightness can help if the image is too dark to distinguish particles. Adjusting contrast can help sharpen the boundaries between particles and the background.
- **Recommendations:** Use these to correct for poor lighting conditions during photography.

### Particle Detection Settings

**Max Cluster Axis (mm)**
- **Function:** Sets the maximum allowed length for a single particle cluster.
- **Default:** 2 mm
- **Effect of Changing:** Limits the size of what the algorithm considers a single particle. 
- **Recommendations:** Set this slightly above the largest expected particle size (e.g., 2-3 mm for coarse grinds, lower for espresso).

**Min Surface (mm²) & Max Surface (mm²)**
- **Function:** Filters particles based on their calculated surface area.
- **Default:** Min: 0.05 mm², Max: 10 mm²
- **Effect of Changing:** Particles smaller than the minimum or larger than the maximum will be excluded from the results.
- **Recommendations:** Use Min Surface to filter out tiny dust specks or "fines" that might be noise. Use Max Surface to exclude large foreign objects or unground beans.

**Min Roundness**
- **Function:** Filters particles based on how circular they are.
- **Default:** 0 (no filtering)
- **Effect of Changing:** Higher values will exclude elongated or irregular particles.
- **Recommendations:** Keep at 0 unless you want to specifically analyze the most spherical grinds.

### Advanced Analysis Settings

**Quick Analysis**
- **Function:** Toggles a simplified detection algorithm that is faster but less precise at separating clumped particles.
- **Default:** Enabled
- **Effect of Changing:** Disabling Quick Analysis enables "clump-breaking" logic, which uses the **Ref. Threshold** and **Max Cost** settings to better identify individual grinds that are touching.
- **Recommendations:** Use Quick Analysis for a fast overview. Disable it for more accurate results if your grinds are touching each other in the image.

**Ref. Threshold (Reference Threshold)**
- **Function:** Used in clump-breaking to define the "core" darkness of a particle.
- **Default:** 0.4
- **Effect of Changing:** Lower values make the algorithm more aggressive at splitting particles.
- **Recommendations:** Adjust if particles that should be separate are being counted as one.

**Max Cost**
- **Function:** Defines the "penalty" for crossing brighter areas between dark centers when trying to split clumps.
- **Default:** 0.35
- **Effect of Changing:** A higher value allows for more variation within a single particle, while a lower value will split particles more easily.
- **Recommendations:** If particles are being split unnecessarily, increase this value.

### Reference & Debug

**Reference Mode**
- **Function:** Determines how the physical scale (pixels per mm) is calculated.
- **Options:** 
    - **Detected:** Automatically finds a reference object (like a coin) in the image.
    - **Auto:** Attempts to guess the scale.
    - **Fixed:** Uses a pre-defined scale.
- **Recommendations:** Use 'Detected' and place a known reference object in your photo for the best accuracy.

**Debug Mode**
- **Function:** Provides technical details and intermediate processing steps.
- **Default:** Disabled
- **Effect of Changing:** Enables additional logging and metadata in the results.
- **Recommendations:** Use if you are troubleshooting why the analysis isn't working as expected.
