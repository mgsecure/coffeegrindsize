import React, { useState } from 'react'
import {
  Container, Typography, Box, AppBar, Toolbar, Button, TextField,
  Grid, Paper, Switch, FormControlLabel, CircularProgress, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Divider
} from '@mui/material'
import axios from 'axios'

function App() {
  const [selectedFile, setSelectedFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Settings
  const [threshold, setThreshold] = useState(58.8)
  const [maxClusterAxis, setMaxClusterAxis] = useState(2) // mm
  const [minSurface, setMinSurface] = useState(0.05) // mm2
  const [maxSurface, setMaxSurface] = useState(10) // mm2
  const [minRoundness, setMinRoundness] = useState(0)
  const [referenceThreshold, setReferenceThreshold] = useState(0.4)
  const [maxCost, setMaxCost] = useState(0.35)
  const [quick, setQuick] = useState(true)
  const [histogramScale, setHistogramScale] = useState('log') // linear, log
  const [histogramMetric, setHistogramMetric] = useState('diameter') // 'diameter' | 'surface'
  const [displayType, setDisplayType] = useState('original') // original, thresholded, outlines

  const handleFileChange = (event) => {
    const file = event.target.files[0]
    if (file) {
      setSelectedFile(file)
      setPreviewUrl(URL.createObjectURL(file))
      setResults(null)
    }
  }

  const handleAnalyze = async () => {
    if (!selectedFile) return

    setLoading(true)
    setError(null)

    const formData = new FormData()
    formData.append('image', selectedFile)
    formData.append('threshold', threshold)
    formData.append('maxClusterAxis', maxClusterAxis)
    formData.append('minSurface', minSurface)
    formData.append('maxSurface', maxSurface)
    formData.append('minRoundness', minRoundness)
    formData.append('referenceThreshold', referenceThreshold)
    formData.append('maxCost', maxCost)
    formData.append('quick', quick)

    try {
      const response = await axios.post('/api/analyze', formData)
      setResults(response.data)
    } catch (err) {
      console.error(err)
      setError('Error during analysis. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Coffee Grind Size Analysis 1
          </Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Grid container spacing={3}>
          {/* Left Panel: Controls */}
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>Settings</Typography>
              <Button
                variant="contained"
                component="label"
                fullWidth
                sx={{ mb: 2 }}
              >
                Upload Image
                <input type="file" hidden accept="image/*" onChange={handleFileChange} />
              </Button>

              <TextField
                label="Threshold (%)"
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                fullWidth
                margin="normal"
                size="small"
              />
              <TextField
                label="Max Cluster Axis (mm)"
                type="number"
                value={maxClusterAxis}
                onChange={(e) => setMaxClusterAxis(e.target.value)}
                fullWidth
                margin="normal"
                size="small"
              />
              <TextField
                label="Min Surface (mm²)"
                type="number"
                value={minSurface}
                onChange={(e) => setMinSurface(e.target.value)}
                fullWidth
                margin="normal"
                size="small"
              />
              <TextField
                label="Max Surface (mm²)"
                type="number"
                value={maxSurface}
                onChange={(e) => setMaxSurface(e.target.value)}
                fullWidth
                margin="normal"
                size="small"
              />
              <TextField
                label="Min Roundness"
                type="number"
                value={minRoundness}
                onChange={(e) => setMinRoundness(e.target.value)}
                fullWidth
                margin="normal"
                size="small"
              />
              {!quick && (
                <>
                  <TextField
                    label="Ref. Threshold"
                    type="number"
                    value={referenceThreshold}
                    onChange={(e) => setReferenceThreshold(e.target.value)}
                    fullWidth
                    margin="normal"
                    size="small"
                  />
                  <TextField
                    label="Max Cost"
                    type="number"
                    value={maxCost}
                    onChange={(e) => setMaxCost(e.target.value)}
                    fullWidth
                    margin="normal"
                    size="small"
                  />
                </>
              )}
              <FormControlLabel
                control={<Switch checked={quick} onChange={(e) => setQuick(e.target.checked)} />}
                label="Quick Analysis"
              />

              <Button
                variant="contained"
                color="primary"
                fullWidth
                onClick={handleAnalyze}
                disabled={!selectedFile || loading}
                sx={{ mt: 2 }}
              >
                {loading ? <CircularProgress size={24} /> : 'Analyze'}
              </Button>
            </Paper>
          </Grid>

          {/* Right Panel: Preview & Results */}
          <Grid item xs={12} md={8}>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            
            <Paper sx={{ p: 2, textAlign: 'center', minHeight: 400 }}>
              {previewUrl ? (
                <Box>
                  <Box sx={{ mb: 2 }}>
                    <ToggleButtonGroup
                      value={displayType}
                      exclusive
                      onChange={(e, next) => next && setDisplayType(next)}
                      size="small"
                    >
                      <ToggleButton value="original">Original</ToggleButton>
                      <ToggleButton value="thresholded" disabled={!results}>Thresholded</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  
                  <Box>
                    {displayType === 'original' && <img src={previewUrl} alt="Original" style={{ maxWidth: '100%', maxHeight: 600 }} />}
                    {displayType === 'thresholded' && results?.thresholdImage && <img src={results.thresholdImage} alt="Thresholded" style={{ maxWidth: '100%', maxHeight: 600 }} />}
                    {displayType === 'outlines' && results?.outlinesImage && <img src={results.outlinesImage} alt="Outlines" style={{ maxWidth: '100%', maxHeight: 600 }} />}
                  </Box>
                </Box>
              ) : (
                <Typography variant="body1" sx={{ mt: 10 }}>
                  Upload an image to start analysis
                </Typography>
              )}
            </Paper>

            {results && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>Analysis Results</Typography>
                <TableContainer component={Paper}>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell component="th" scope="row">Image Size</TableCell>
                        <TableCell align="right">{results.width} x {results.height}</TableCell>
                      </TableRow>
                      {results.pixelScale && (
                          <TableRow>
                            <TableCell component="th" scope="row">Pixel Scale</TableCell>
                            <TableCell align="right">{results.pixelScale.toFixed(3)} pix/mm</TableCell>
                          </TableRow>
                      )}
                      <TableRow>
                        <TableCell component="th" scope="row">Particle Count</TableCell>
                        <TableCell align="right">{results.particleCount}</TableCell>
                      </TableRow>
                      {results.statistics && (
                        <>
                          <TableRow>
                            <TableCell component="th" scope="row">D10</TableCell>
                            <TableCell align="right">{results.statistics.D10.toFixed(3)} mm</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell component="th" scope="row">D50 (Median)</TableCell>
                            <TableCell align="right">{results.statistics.D50.toFixed(3)} mm</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell component="th" scope="row">D90</TableCell>
                            <TableCell align="right">{results.statistics.D90.toFixed(3)} mm</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell component="th" scope="row">Mode</TableCell>
                            <TableCell align="right">{results.statistics.mode.toFixed(3)} mm</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell component="th" scope="row">Std. Dev.</TableCell>
                            <TableCell align="right">{results.statistics.stdDev.toFixed(3)} mm</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell component="th" scope="row">Mean</TableCell>
                            <TableCell align="right">{results.statistics.mean.toFixed(3)} mm</TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>

                {results.pixelScale && results.particles.length > 0 && (
                  <Box sx={{ mt: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="h6">Size Distribution (% Mass vs {histogramMetric === 'diameter' ? 'Diameter (mm)' : 'Surface (mm²)'})</Typography>
                      <ToggleButtonGroup
                        value={histogramScale}
                        exclusive
                        onChange={(e, next) => next && setHistogramScale(next)}
                        size="small"
                      >
                        <ToggleButton value="log">Log</ToggleButton>
                        <ToggleButton value="linear">Linear</ToggleButton>
                      </ToggleButtonGroup>
                      <ToggleButtonGroup
                        value={histogramMetric}
                        exclusive
                        onChange={(e, next) => next && setHistogramMetric(next)}
                        size="small"
                        sx={{ ml: 1 }}
                      >
                        <ToggleButton value="diameter">Diameter</ToggleButton>
                        <ToggleButton value="surface">Surface</ToggleButton>
                      </ToggleButtonGroup>
                    </Box>
                    <Paper sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-end', height: 250, width: 650, gap: '2px' }}>
                        {(() => {
                          const particles = results.particles;
                          // X-axis values depend on selected metric
                          const values = particles.map(p => histogramMetric === 'diameter' ? p.diameterMm : p.surfaceMm2);
                          let min = Math.min(...values);
                          let max = Math.max(...values);

                          // Ensure min is positive for log scale
                          if (histogramScale === 'log' && min <= 0) {
                             min = 0.01;
                          }
                          
                          const binCount = 20;
                          let bins = [];
                          
                          if (histogramScale === 'log') {
                            const logMin = Math.log10(min);
                            const logMax = Math.log10(max);
                            const step = (logMax - logMin) / binCount;
                            for (let i = 0; i <= binCount; i++) {
                              bins.push(Math.pow(10, logMin + i * step));
                            }
                          } else {
                            const step = (max - min) / binCount;
                            for (let i = 0; i <= binCount; i++) {
                              bins.push(min + i * step);
                            }
                          }
                          
                          const binMasses = new Array(binCount).fill(0);
                          const binCounts = new Array(binCount).fill(0);
                          let totalMass = 0;
                          
                          particles.forEach(p => {
                            const v = histogramMetric === 'diameter' ? p.diameterMm : p.surfaceMm2;
                            let binIdx;
                            if (histogramScale === 'log') {
                              if (v <= bins[0]) binIdx = 0;
                              else if (v >= bins[binCount]) binIdx = binCount - 1;
                              else {
                                binIdx = Math.floor((Math.log10(v) - Math.log10(bins[0])) / (Math.log10(bins[1]) - Math.log10(bins[0])));
                                binIdx = Math.min(binIdx, binCount - 1);
                              }
                            } else {
                              binIdx = Math.min(Math.floor((v - min) / (bins[1] - bins[0])), binCount - 1);
                            }
                            if (binIdx >= 0) {
                              binMasses[binIdx] += p.volumeMm3; // mass is volume in mm^3
                              binCounts[binIdx]++;
                              totalMass += p.volumeMm3;
                            }
                          });

                           const binPercentages = binMasses.map(mass => (mass / totalMass) * 100);
                           const maxPercentage = Math.max(...binPercentages, 0.01);

                          return binPercentages.map((percentage, i) => (
                            <Box 
                              key={i} 
                              sx={{ 
                                flex: 1, 
                                bgcolor: 'primary.main', 
                                height: `${(percentage / maxPercentage) * 100}%`,
                                minWidth: '5px'
                              }} 
                              title={`Bin ${i}: ${bins[i].toFixed(3)}-${bins[i+1].toFixed(3)} ${histogramMetric === 'diameter' ? 'mm' : 'mm²'}\nMass: ${percentage.toFixed(2)}%\nCount: ${binCounts[i]}`}
                            />
                          ));
                        })()}
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                        {(() => {
                           const valuesForLabels = results.particles.map(p => histogramMetric === 'diameter' ? p.diameterMm : p.surfaceMm2);
                           const min = Math.min(...valuesForLabels);
                           const max = Math.max(...valuesForLabels);
                           const unit = histogramMetric === 'diameter' ? 'mm' : 'mm²';
                           if (histogramScale === 'log') {
                             // Show more labels for log scale
                             const labels = [];
                             const logMin = Math.log10(min > 0 ? min : 0.01);
                             const logMax = Math.log10(max);
                             for (let i = 0; i <= 4; i++) {
                               const val = Math.pow(10, logMin + (i/4) * (logMax - logMin));
                               labels.push(<Typography key={i} variant="caption">{val.toFixed(2)}{unit}</Typography>);
                             }
                             return labels;
                           }
                           return (
                             <>
                               <Typography variant="caption">{min.toFixed(2)}{unit}</Typography>
                               <Typography variant="caption">{max.toFixed(2)}{unit}</Typography>
                             </>
                           )
                        })()}
                      </Box>
                    </Paper>
                  </Box>
                )}
              </Box>
            )}
          </Grid>
        </Grid>
      </Container>
    </Box>
  )
}

export default App
