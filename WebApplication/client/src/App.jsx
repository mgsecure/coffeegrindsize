import React, {useCallback, useState} from 'react'
import {
    Container, Typography, Box, AppBar, Toolbar, Button, TextField,
    Grid, Paper, Switch, FormControlLabel, CircularProgress, Alert,
    Table, TableBody, TableCell, TableContainer, TableRow,
    ToggleButton, ToggleButtonGroup
} from '@mui/material'
import axios from 'axios'
import Histogram from './Histogram.jsx'
import ExportButton from './ExportButton.jsx'
import Dropzone from './formUtils/Dropzone.jsx'
import useWindowSize from './util/useWindowSize.jsx'
import ContentDrawerButton from './misc/ContentDrawerButton.jsx'

function App() {
    const [droppedFiles, setDroppedFiles] = useState([])
    const [selectedFile, setSelectedFile] = useState(null)
    const [previewUrl, setPreviewUrl] = useState(null)
    const [results, setResults] = useState(null)
    const [terseResults, setTerseResults] = useState(null)
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
    const [brightness, setBrightness] = useState(1.0)
    const [contrast, setContrast] = useState(1.0)
    const [referenceMode, setReferenceMode] = useState('detected')
    const [debug, setDebug] = useState(false)
    const [quick, setQuick] = useState(true)
    const [histogramScale, setHistogramScale] = useState('log') // linear, log
    const [histogramMetric, setHistogramMetric] = useState('diameter') // 'diameter' | 'surface'
    const [displayType, setDisplayType] = useState('original') // original, thresholded, outlines
    const [yAxisMetric, setYAxisMetric] = useState('mass') // 'mass' | 'count'

    const handleFileChange = (event) => {
        const file = event.target.files[0]
        if (file) {
            setSelectedFile(file)
            setPreviewUrl(URL.createObjectURL(file))
            setDisplayType('original')
            setResults(null)
        }
    }

    const handleDroppedFiles = useCallback((allFiles) => {
        if (allFiles && allFiles.length > 0) {
            setDroppedFiles(allFiles)
            setSelectedFile(allFiles[0])
            setPreviewUrl(URL.createObjectURL(allFiles[0]))
        } else {
            setDroppedFiles([])
            setSelectedFile(null)
            setPreviewUrl(null)
        }
        setDisplayType('original')
        setResults(null)
    }, [])

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
        formData.append('brightness', brightness)
        formData.append('contrast', contrast)
        formData.append('referenceMode', referenceMode)
        formData.append('debug', debug)
        formData.append('quick', quick)

        try {
            const response = await axios.post('/api/analyze', formData)
            setResults(response.data)
            setDisplayType('thresholded')
            const resultsCopy = {...response.data}
            delete resultsCopy.thresholdImage
            delete resultsCopy.outlinesImage
            setTerseResults(resultsCopy)
        } catch (err) {
            console.error(err)
            setError('Error during analysis. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const particles = results?.particles || []
    // X-axis values depend on selected metric
    const values = particles.map(p => histogramMetric === 'diameter' ? p.diameterMm : p.surfaceMm2)
    let min = Math.min(...values)
    let max = histogramMetric === 'diameter' ? (maxClusterAxis || Math.max(...values, 5)) : (maxClusterAxis || Math.max(...values, 5))

    // Ensure min is positive for log scale
    if (histogramScale === 'log' && min <= 0) {
        min = 0.01
    }

    const binCount = 20
    let bins = []

    if (histogramScale === 'log') {
        const logMin = Math.log10(min)
        const logMax = Math.log10(max)
        const step = (logMax - logMin) / binCount
        for (let i = 0; i <= binCount; i++) {
            bins.push(Math.pow(10, logMin + i * step))
        }
    } else {
        const step = (max - min) / binCount
        for (let i = 0; i <= binCount; i++) {
            bins.push(min + i * step)
        }
    }

    const binMasses = new Array(binCount).fill(0)
    const binCounts = new Array(binCount).fill(0)
    let totalMass = 0

    particles.forEach(p => {
        const v = histogramMetric === 'diameter' ? p.diameterMm : p.surfaceMm2
        let binIdx
        if (histogramScale === 'log') {
            if (v <= bins[0]) binIdx = 0
            else if (v >= bins[binCount]) binIdx = binCount - 1
            else {
                // v = bins[0] * (bins[1]/bins[0])^idx
                // log10(v) = log10(bins[0]) + idx * log10(bins[1]/bins[0])
                // idx = (log10(v) - log10(bins[0])) / log10(bins[1]/bins[0])
                binIdx = Math.floor((Math.log10(v) - Math.log10(bins[0])) / (Math.log10(bins[1]) - Math.log10(bins[0])))
                binIdx = Math.min(Math.max(0, binIdx), binCount - 1)
            }
        } else {
            if (v <= bins[0]) binIdx = 0
            else if (v >= bins[binCount]) binIdx = binCount - 1
            else {
                binIdx = Math.floor((v - min) / (bins[1] - bins[0]))
                binIdx = Math.min(Math.max(0, binIdx), binCount - 1)
            }
        }
        if (binIdx >= 0 && binIdx < binCount) {
            binMasses[binIdx] += p.volumeMm3 // mass is volume in mm^3
            binCounts[binIdx]++
            totalMass += p.volumeMm3
        }
    })

    const binPercentages = binMasses.map(mass => (mass / totalMass) * 100)

    const binData = {
        bins,
        binCounts,
        binPercentages,
        histogramScale,
        histogramMetric,
        min,
        max,
        statistics: results?.statistics,
        yAxisMetric,
        setYAxisMetric
    }

    const maxImages = 5

    const {isMobile, flexStyle} = useWindowSize()
    const displayWidth = isMobile ? 350 : 700

    return (
        <Box sx={{flexGrow: 1}}>
            <AppBar position='static'>
                <Toolbar>
                    <Typography variant='h5' component='div' sx={{flexGrow: 1, fontWeight: 700}}>
                        Coffee Grind Size Analysis
                    </Typography>
                </Toolbar>
            </AppBar>
            <Container sx={{mt: 4, mb: 4, width: displayWidth, padding: 0}}>
                <Grid container spacing={3}>
                    {/* Left Panel: Controls */}
                    <Grid xs={12} md={4}>
                        <Paper sx={{p: 2}}>
                            <Typography variant='h6'>Choose Image</Typography>

                            <Box style={{marginBottom: 20}}>
                                <Dropzone files={droppedFiles}
                                          handleDroppedFiles={handleDroppedFiles} maxFiles={maxImages}/>
                            </Box>

                            <Box sx={{
                                display: 'flex',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 1
                            }}>
                                <Typography variant='h6'>Settings</Typography>
                                <ContentDrawerButton/>
                            </Box>

                            <TextField
                                label='Threshold (%)'
                                type='number'
                                value={threshold}
                                onChange={(e) => setThreshold(e.target.value)}
                                fullWidth
                                margin='normal'
                                size='small'
                            />
                            <Grid container spacing={1}>
                                <Grid item xs={6}>
                                    <TextField
                                        label='Brightness'
                                        type='number'
                                        value={brightness}
                                        onChange={(e) => setBrightness(e.target.value)}
                                        fullWidth
                                        margin='normal'
                                        size='small'
                                        inputProps={{step: 0.1}}
                                    />
                                </Grid>
                                <Grid item xs={6}>
                                    <TextField
                                        label='Contrast'
                                        type='number'
                                        value={contrast}
                                        onChange={(e) => setContrast(e.target.value)}
                                        fullWidth
                                        margin='normal'
                                        size='small'
                                        inputProps={{step: 0.1}}
                                    />
                                </Grid>
                            </Grid>
                            <TextField
                                label='Max Cluster Axis (mm)'
                                type='number'
                                value={maxClusterAxis}
                                onChange={(e) => setMaxClusterAxis(e.target.value)}
                                fullWidth
                                margin='normal'
                                size='small'
                            />
                            <TextField
                                label='Min Surface (mm²)'
                                type='number'
                                value={minSurface}
                                onChange={(e) => setMinSurface(e.target.value)}
                                fullWidth
                                margin='normal'
                                size='small'
                            />
                            <TextField
                                label='Max Surface (mm²)'
                                type='number'
                                value={maxSurface}
                                onChange={(e) => setMaxSurface(e.target.value)}
                                fullWidth
                                margin='normal'
                                size='small'
                            />
                            <TextField
                                label='Min Roundness'
                                type='number'
                                value={minRoundness}
                                onChange={(e) => setMinRoundness(e.target.value)}
                                fullWidth
                                margin='normal'
                                size='small'
                            />
                            {!quick && (
                                <>
                                    <TextField
                                        label='Ref. Threshold'
                                        type='number'
                                        value={referenceThreshold}
                                        onChange={(e) => setReferenceThreshold(e.target.value)}
                                        fullWidth
                                        margin='normal'
                                        size='small'
                                    />
                                    <TextField
                                        label='Max Cost'
                                        type='number'
                                        value={maxCost}
                                        onChange={(e) => setMaxCost(e.target.value)}
                                        fullWidth
                                        margin='normal'
                                        size='small'
                                    />
                                </>
                            )}
                            <FormControlLabel
                                control={<Switch checked={quick} onChange={(e) => setQuick(e.target.checked)}/>}
                                label='Quick Analysis'
                            />

                            <ToggleButtonGroup
                                value={referenceMode}
                                exclusive
                                onChange={(e, next) => next && setReferenceMode(next)}
                                size='small'
                                fullWidth
                                sx={{mb: 2}}
                            >
                                <ToggleButton value='detected'>Detected</ToggleButton>
                                <ToggleButton value='auto'>Auto</ToggleButton>
                                <ToggleButton value='fixed'>Fixed</ToggleButton>
                            </ToggleButtonGroup>

                            <FormControlLabel
                                control={<Switch checked={debug} onChange={(e) => setDebug(e.target.checked)}/>}
                                label='Debug Mode'
                            />

                            <Button
                                variant='contained'
                                color='primary'
                                fullWidth
                                onClick={handleAnalyze}
                                disabled={!selectedFile || loading}
                                sx={{mt: 2}}
                            >
                                {loading ? <CircularProgress size={24}/> : 'Analyze'}
                            </Button>
                        </Paper>
                    </Grid>

                    {/* Right Panel: Preview & Results */}
                    <Grid xs={12} md={8}>
                        {error && <Alert severity='error' sx={{mb: 2}}>{error}</Alert>}

                        {previewUrl && (
                            <Paper sx={{p: 2, textAlign: 'center', minHeight: 400}}>
                                <Box>
                                    <Box sx={{mb: 2}}>
                                        <ToggleButtonGroup
                                            value={displayType}
                                            exclusive
                                            onChange={(e, next) => next && setDisplayType(next)}
                                            size='small'
                                        >
                                            <ToggleButton value='original'>Original</ToggleButton>
                                            <ToggleButton value='thresholded'
                                                          disabled={!results}>Thresholded</ToggleButton>
                                            <ToggleButton value='outlines'
                                                          disabled={!results}>Outlines</ToggleButton>
                                        </ToggleButtonGroup>
                                    </Box>

                                    <Box>
                                        {displayType === 'original' && <img src={previewUrl} alt='Original' style={{
                                            maxWidth: '100%',
                                            maxHeight: 600
                                        }}/>}
                                        {displayType === 'thresholded' && results?.thresholdImage &&
                                            <img src={results.thresholdImage} alt='Thresholded'
                                                 style={{maxWidth: '100%', maxHeight: 600}}/>}
                                        {displayType === 'outlines' && results?.outlinesImage &&
                                            <img src={results.outlinesImage} alt='Outlines'
                                                 style={{maxWidth: '100%', maxHeight: 600}}/>}
                                    </Box>
                                    {results?.debug && (
                                        <Box sx={{
                                            mt: 2,
                                            textAlign: 'left',
                                            p: 1,
                                            bgcolor: '#f5f5f5',
                                            borderRadius: 1,
                                            fontSize: '0.8rem'
                                        }}>
                                            <Typography variant='caption' display='block'><b>Debug
                                                Info:</b></Typography>
                                            <pre style={{
                                                margin: 0,
                                                overflow: 'auto'
                                            }}>{JSON.stringify(results.debug, null, 2)}</pre>
                                        </Box>
                                    )}
                                </Box>
                            </Paper>
                        )}

                        {results && (
                            <Box sx={{mt: 3, width: displayWidth}}>
                                <Typography variant='h6' gutterBottom>Image Details</Typography>
                                <TableContainer component={Paper} style={{marginBottom: 30}}>
                                    <Table size='small'>
                                        <TableBody>
                                            {selectedFile?.name && (
                                                <TableRow>
                                                    <TableCell component='th' scope='row'>Filename</TableCell>
                                                    <TableCell align='right'>{selectedFile.name}</TableCell>
                                                </TableRow>
                                            )}
                                            <TableRow>
                                                <TableCell component='th' scope='row'>Image Size</TableCell>
                                                <TableCell align='right'>{results.width} x {results.height}</TableCell>
                                            </TableRow>
                                            {results.pixelScale && (
                                                <TableRow>
                                                    <TableCell component='th' scope='row'>Pixel Scale</TableCell>
                                                    <TableCell
                                                        align='right'>{results.pixelScale.toFixed(3)} pix/mm</TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </TableContainer>

                                <Box sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    mb: 1,
                                    flexWrap: 'wrap',
                                    gap: 1
                                }}>
                                    <Typography variant='h6' gutterBottom>Particle Analysis Results</Typography>
                                    <ToggleButtonGroup
                                        value={histogramMetric}
                                        exclusive
                                        onChange={(e, next) => next && setHistogramMetric(next)}
                                        size='small'
                                    >
                                        <ToggleButton value='diameter'>Diameter</ToggleButton>
                                        <ToggleButton value='surface'>Surface</ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                                <TableContainer component={Paper}>
                                    <Table size='small'>
                                        <TableBody>
                                            <TableRow>
                                                <TableCell component='th' scope='row'>Particle Count</TableCell>
                                                <TableCell align='right'>{results.particleCount}</TableCell>
                                            </TableRow>
                                            {results.statistics && (
                                                (() => {
                                                    const statSource = histogramMetric === 'diameter' ? (results.statistics.diameter || results.statistics) : results.statistics.surface
                                                    const unit = histogramMetric === 'diameter' ? 'mm' : 'mm²'
                                                    const prefix = histogramMetric === 'diameter' ? 'D' : 'S'

                                                    if (!statSource) return null

                                                    return (
                                                        <>
                                                            <TableRow>
                                                                <TableCell component='th'
                                                                           scope='row'>{prefix}10</TableCell>
                                                                <TableCell
                                                                    align='right'>{statSource.p10?.toFixed(3) || statSource.D10?.toFixed(3)} {unit}</TableCell>
                                                            </TableRow>
                                                            <TableRow>
                                                                <TableCell component='th' scope='row'>{prefix}50
                                                                    (Median)</TableCell>
                                                                <TableCell
                                                                    align='right'>{statSource.p50?.toFixed(3) || statSource.D50?.toFixed(3)} {unit}</TableCell>
                                                            </TableRow>
                                                            <TableRow>
                                                                <TableCell component='th'
                                                                           scope='row'>{prefix}90</TableCell>
                                                                <TableCell
                                                                    align='right'>{statSource.p90?.toFixed(3) || statSource.D90?.toFixed(3)} {unit}</TableCell>
                                                            </TableRow>
                                                            <TableRow>
                                                                <TableCell component='th' scope='row'>Mode</TableCell>
                                                                <TableCell
                                                                    align='right'>{statSource.mode.toFixed(3)} {unit}</TableCell>
                                                            </TableRow>
                                                            <TableRow>
                                                                <TableCell component='th' scope='row'>Std.
                                                                    Dev.</TableCell>
                                                                <TableCell
                                                                    align='right'>{statSource.stdDev.toFixed(3)} {unit}</TableCell>
                                                            </TableRow>
                                                            <TableRow>
                                                                <TableCell component='th' scope='row'>Mean</TableCell>
                                                                <TableCell
                                                                    align='right'>{statSource.mean.toFixed(3)} {unit}</TableCell>
                                                            </TableRow>
                                                        </>
                                                    )
                                                })()
                                            )}
                                        </TableBody>
                                    </Table>
                                </TableContainer>

                                {results.pixelScale && results.particles.length > 0 && (
                                    <Histogram binData={binData} histogramScale={histogramScale}
                                               setHistogramScale={setHistogramScale} histogramMetric={histogramMetric}
                                               setHistogramMetric={setHistogramMetric}/>
                                )}
                            </Box>
                        )}
                    </Grid>
                </Grid>
            </Container>
            {results && (
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    mb: 4,
                    flexWrap: 'wrap',
                    gap: 1,
                    maxWidth: '650px'
                }}>
                    <ExportButton text='Export' filename={selectedFile?.name} particles={results?.particles}
                                  binData={binData} statistics={results?.statistics}/>
                </Box>
            )}
        </Box>
    )
}

export default App
