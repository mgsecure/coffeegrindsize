import React, {useCallback, useState} from 'react'
import {
    Container, Typography, Box, AppBar, Toolbar, Button, TextField,
    Grid, Paper, Switch, FormControlLabel, CircularProgress, Alert,
    Table, TableBody, TableCell, TableContainer, TableRow,
    ToggleButton, ToggleButtonGroup
} from '@mui/material'
import axios from 'axios'
import HistogramSelect from './HistogramSelect.jsx'
import ExportButton from './ExportButton.jsx'
import Dropzone from './formUtils/Dropzone.jsx'
import useWindowSize from './util/useWindowSize.jsx'
import ContentDrawerButton from './misc/ContentDrawerButton.jsx'

function App() {
    const [droppedFiles, setDroppedFiles] = useState([])
    const [results, setResults] = useState([]) // Array of results for each file
    const [selectedResultIndices, setSelectedResultIndices] = useState([])
    const [viewMode, setViewMode] = useState('single') // 'single', 'comparison', 'aggregate'
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

    const handleDroppedFiles = useCallback((allFiles) => {
        if (allFiles && allFiles.length > 0) {
            setDroppedFiles(allFiles)
        } else {
            setDroppedFiles([])
        }
        setDisplayType('original')
        setResults([])
        setSelectedResultIndices([])
    }, [])

    const handleAnalyze = async () => {
        if (droppedFiles.length === 0) return

        setLoading(true)
        setError(null)
        setResults([])

        const allResults = []

        for (const file of droppedFiles) {
            const formData = new FormData()
            formData.append('image', file)
            formData.append('threshold', parseFloat(threshold))
            formData.append('maxClusterAxis', parseFloat(maxClusterAxis))
            formData.append('minSurface', parseFloat(minSurface))
            formData.append('maxSurface', parseFloat(maxSurface))
            formData.append('minRoundness', parseFloat(minRoundness))
            formData.append('referenceThreshold', parseFloat(referenceThreshold))
            formData.append('maxCost', parseFloat(maxCost))
            formData.append('brightness', parseFloat(brightness))
            formData.append('contrast', parseFloat(contrast))
            formData.append('referenceMode', referenceMode)
            formData.append('debug', debug)
            formData.append('quick', quick)

            try {
                const response = await axios.post('/api/analyze', formData)
                allResults.push({
                    filename: file.name,
                    previewUrl: file.preview, // Use the preview URL already created by Dropzone
                    ...response.data
                })
            } catch (err) {
                console.error(`Error analyzing ${file.name}:`, err)
                const errorMsg = err.response?.data?.message || err.response?.data?.error || err.message
                setError(`Error analyzing ${file.name}: ${errorMsg}`)
                break
            }
        }

        if (allResults.length > 0) {
            setResults(allResults)
            setSelectedResultIndices([0])
            setDisplayType('thresholded')
            setViewMode('single')
        }
        setLoading(false)
    }

    const getAggregatedParticles = (resultList) => {
        return resultList.reduce((acc, res) => acc.concat(res.particles || []), [])
    }

    const calculateBinData = (particles, stats, filename = 'Aggregate') => {
        if (!particles || particles.length === 0) return null

        const values = particles.map(p => histogramMetric === 'diameter' ? p.diameterMm : p.surfaceMm2)
        let minVal = Math.min(...values)
        let maxVal = histogramMetric === 'diameter' ? (maxClusterAxis || Math.max(...values, 5)) : (maxClusterAxis || Math.max(...values, 5))

        if (histogramScale === 'log' && minVal <= 0) {
            minVal = 0.01
        }

        const binCount = 20
        let bins = []

        if (histogramScale === 'log') {
            const logMin = Math.log10(minVal)
            const logMax = Math.log10(maxVal)
            const step = (logMax - logMin) / binCount
            for (let i = 0; i <= binCount; i++) {
                bins.push(Math.pow(10, logMin + i * step))
            }
        } else {
            const step = (maxVal - minVal) / binCount
            for (let i = 0; i <= binCount; i++) {
                bins.push(minVal + i * step)
            }
        }

        const binMasses = new Array(binCount).fill(0)
        const binCounts = new Array(binCount).fill(0)
        let totalMass = 0
        let totalCount = 0

        particles.forEach(p => {
            const v = histogramMetric === 'diameter' ? p.diameterMm : p.surfaceMm2
            let binIdx
            if (histogramScale === 'log') {
                if (v <= bins[0]) binIdx = 0
                else if (v >= bins[binCount]) binIdx = binCount - 1
                else {
                    binIdx = Math.floor((Math.log10(v) - Math.log10(bins[0])) / (Math.log10(bins[1]) - Math.log10(bins[0])))
                    binIdx = Math.min(Math.max(0, binIdx), binCount - 1)
                }
            } else {
                if (v <= bins[0]) binIdx = 0
                else if (v >= bins[binCount]) binIdx = binCount - 1
                else {
                    binIdx = Math.floor((v - minVal) / (bins[1] - bins[0]))
                    binIdx = Math.min(Math.max(0, binIdx), binCount - 1)
                }
            }
            if (binIdx >= 0 && binIdx < binCount) {
                binMasses[binIdx] += p.volumeMm3
                binCounts[binIdx]++
                totalMass += p.volumeMm3
                totalCount++
            }
        })

        const binPercentages = binMasses.map(mass => totalMass > 0 ? (mass / totalMass) * 100 : 0)
        const binCountPercentages = binCounts.map(count => totalCount > 0 ? (count / totalCount) * 100 : 0)

        console.log(`Calculated bin data for ${filename}:`, {bins, binCounts, binPercentages, binCountPercentages, minVal, maxVal})
        return {
            id: filename,
            bins,
            binCounts,
            binPercentages,
            binCountPercentages,
            histogramScale,
            histogramMetric,
            min: minVal,
            max: maxVal,
            statistics: stats,
            yAxisMetric
        }
    }

    let binDataList = []
    let combinedStats = null

    if (results.length > 0) {
        if (viewMode === 'single' && selectedResultIndices.length > 0) {
            const res = results[selectedResultIndices[0]]
            if (res) {
                binDataList = [calculateBinData(res.particles, res.statistics, res.filename)]
            }
        } else if (viewMode === 'comparison' && selectedResultIndices.length > 0) {
            binDataList = selectedResultIndices.map(idx => {
                const res = results[idx]
                return res ? calculateBinData(res.particles, res.statistics, res.filename) : null
            }).filter(Boolean)
        } else if (viewMode === 'aggregate') {
            const allParticles = getAggregatedParticles(results)
            binDataList = [calculateBinData(allParticles, null, 'Aggregate')]
        }
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
                                <Grid xs={6}>
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
                                <Grid xs={6}>
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
                                        disabled={droppedFiles.length === 0 || loading}
                                        sx={{mt: 2}}
                                    >
                                        {loading ? <CircularProgress size={24}/> : 'Analyze All'}
                                    </Button>
                        </Paper>
                    </Grid>

                    {/* Right Panel: Preview & Results */}
                    <Grid xs={12} md={8}>
                        {error && <Alert severity='error' sx={{mb: 2}}>{error}</Alert>}

                        {results.length > 0 && (
                            <Paper sx={{p: 2, mb: 3}}>
                                <Typography variant='h6' gutterBottom>Select Results to View</Typography>
                                <Box sx={{display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap'}}>
                                    <Button
                                        variant={viewMode === 'aggregate' ? 'contained' : 'outlined'}
                                        onClick={() => {
                                            setViewMode('aggregate')
                                            setSelectedResultIndices([])
                                        }}
                                    >
                                        Aggregate View
                                    </Button>
                                    {results.map((res, idx) => (
                                        <Button
                                            key={idx}
                                            variant={selectedResultIndices.includes(idx) ? 'contained' : 'outlined'}
                                            onClick={() => {
                                                if (viewMode === 'comparison') {
                                                    if (selectedResultIndices.includes(idx)) {
                                                        setSelectedResultIndices(selectedResultIndices.filter(i => i !== idx))
                                                    } else {
                                                        if (selectedResultIndices.length < 2) {
                                                            setSelectedResultIndices([...selectedResultIndices, idx])
                                                        } else {
                                                            setSelectedResultIndices([selectedResultIndices[1], idx])
                                                        }
                                                    }
                                                } else {
                                                    setViewMode('single')
                                                    setSelectedResultIndices([idx])
                                                }
                                            }}
                                            size='small'
                                        >
                                            {res.filename}
                                        </Button>
                                    ))}
                                </Box>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={viewMode === 'comparison'}
                                            onChange={(e) => {
                                                setViewMode(e.target.checked ? 'comparison' : 'single')
                                                if (e.target.checked) {
                                                    if (selectedResultIndices.length > 2) {
                                                        setSelectedResultIndices(selectedResultIndices.slice(0, 2))
                                                    }
                                                } else {
                                                    setSelectedResultIndices(selectedResultIndices.length > 0 ? [selectedResultIndices[0]] : [])
                                                }
                                            }}
                                        />
                                    }
                                    label='Comparison Mode (Select 2)'
                                />
                            </Paper>
                        )}

                        {viewMode === 'single' && selectedResultIndices.length > 0 && results[selectedResultIndices[0]] && (
                            <Paper sx={{p: 2, textAlign: 'center', minHeight: 400}}>
                                {(() => {
                                    const res = results[selectedResultIndices[0]]
                                    return (
                                        <Box>
                                            <Box sx={{mb: 2}}>
                                                <ToggleButtonGroup
                                                    value={displayType}
                                                    exclusive
                                                    onChange={(e, next) => next && setDisplayType(next)}
                                                    size='small'
                                                >
                                                    <ToggleButton value='original'>Original</ToggleButton>
                                                    <ToggleButton value='thresholded'>Thresholded</ToggleButton>
                                                    <ToggleButton value='outlines'>Outlines</ToggleButton>
                                                </ToggleButtonGroup>
                                            </Box>

                                            <Box>
                                                {displayType === 'original' && res.previewUrl && <img src={res.previewUrl} alt='Original'
                                                                                    style={{
                                                                                        maxWidth: '100%',
                                                                                        maxHeight: 600
                                                                                    }}/>}
                                                {displayType === 'thresholded' && res.thresholdImage &&
                                                    <img src={res.thresholdImage} alt='Thresholded'
                                                         style={{maxWidth: '100%', maxHeight: 600}}/>}
                                                {displayType === 'outlines' && res.outlinesImage &&
                                                    <img src={res.outlinesImage} alt='Outlines'
                                                         style={{maxWidth: '100%', maxHeight: 600}}/>}
                                            </Box>
                                        </Box>
                                    )
                                })()}
                            </Paper>
                        )}

                        {binDataList.length > 0 && (
                            <Box sx={{mt: 3, width: displayWidth}}>
                                {((viewMode === 'single' || viewMode === 'comparison') && selectedResultIndices.length > 0) && (
                                    <>
                                        <Typography variant='h6' gutterBottom>Image Details</Typography>
                                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
                                            {selectedResultIndices.map(idx => {
                                                const res = results[idx];
                                                if (!res) return null;
                                                return (
                                                    <TableContainer key={idx} component={Paper} sx={{ flex: 1, minWidth: 300 }}>
                                                        <Table size='small'>
                                                            <TableBody>
                                                                <TableRow>
                                                                    <TableCell component='th' scope='row'>Filename</TableCell>
                                                                    <TableCell align='right'>{res.filename}</TableCell>
                                                                </TableRow>
                                                                <TableRow>
                                                                    <TableCell component='th' scope='row'>Image Size</TableCell>
                                                                    <TableCell align='right'>{res.width} x {res.height}</TableCell>
                                                                </TableRow>
                                                                {res.pixelScale && (
                                                                    <TableRow>
                                                                        <TableCell component='th' scope='row'>Pixel Scale</TableCell>
                                                                        <TableCell align='right'>{res.pixelScale.toFixed(3)} pix/mm</TableCell>
                                                                    </TableRow>
                                                                )}
                                                            </TableBody>
                                                        </Table>
                                                    </TableContainer>
                                                );
                                            })}
                                        </Box>
                                    </>
                                )}

                                <Box sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    mb: 1,
                                    flexWrap: 'wrap',
                                    gap: 1
                                }}>
                                    <Typography variant='h6' gutterBottom>
                                        {viewMode === 'aggregate' ? 'Aggregated Results' : (viewMode === 'comparison' ? 'Comparison Results' : 'Particle Analysis Results')}
                                    </Typography>
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

                                {(viewMode === 'single' || viewMode === 'comparison') && selectedResultIndices.length > 0 && (
                                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                        {selectedResultIndices.map(idx => {
                                            const res = results[idx];
                                            if (!res) return null;
                                            return (
                                                <TableContainer key={idx} component={Paper} sx={{ flex: 1, minWidth: 300 }}>
                                                    <Table size='small'>
                                                        <TableBody>
                                                            <TableRow>
                                                                <TableCell component='th' scope='row' sx={{ fontWeight: 'bold' }}>{res.filename}</TableCell>
                                                                <TableCell align='right'></TableCell>
                                                            </TableRow>
                                                            <TableRow>
                                                                <TableCell component='th' scope='row'>Particle Count</TableCell>
                                                                <TableCell align='right'>{res.particleCount}</TableCell>
                                                            </TableRow>
                                                            {res.statistics && (
                                                                (() => {
                                                                    const statSource = histogramMetric === 'diameter' ? (res.statistics.diameter || res.statistics) : res.statistics.surface
                                                                    const unit = histogramMetric === 'diameter' ? 'mm' : 'mm²'
                                                                    const prefix = histogramMetric === 'diameter' ? 'D' : 'S'

                                                                    if (!statSource) return null

                                                                    return (
                                                                        <>
                                                                            <TableRow>
                                                                                <TableCell component='th' scope='row'>{prefix}10</TableCell>
                                                                                <TableCell align='right'>{statSource.p10?.toFixed(3) || statSource.D10?.toFixed(3)} {unit}</TableCell>
                                                                            </TableRow>
                                                                            <TableRow>
                                                                                <TableCell component='th' scope='row'>{prefix}50 (Median)</TableCell>
                                                                                <TableCell align='right'>{statSource.p50?.toFixed(3) || statSource.D50?.toFixed(3)} {unit}</TableCell>
                                                                            </TableRow>
                                                                            <TableRow>
                                                                                <TableCell component='th' scope='row'>{prefix}90</TableCell>
                                                                                <TableCell align='right'>{statSource.p90?.toFixed(3) || statSource.D90?.toFixed(3)} {unit}</TableCell>
                                                                            </TableRow>
                                                                            <TableRow>
                                                                                <TableCell component='th' scope='row'>Mode</TableCell>
                                                                                <TableCell align='right'>{statSource.mode.toFixed(3)} {unit}</TableCell>
                                                                            </TableRow>
                                                                            <TableRow>
                                                                                <TableCell component='th' scope='row'>Std. Dev.</TableCell>
                                                                                <TableCell align='right'>{statSource.stdDev.toFixed(3)} {unit}</TableCell>
                                                                            </TableRow>
                                                                            <TableRow>
                                                                                <TableCell component='th' scope='row'>Mean</TableCell>
                                                                                <TableCell align='right'>{statSource.mean.toFixed(3)} {unit}</TableCell>
                                                                            </TableRow>
                                                                        </>
                                                                    )
                                                                })()
                                                            )}
                                                        </TableBody>
                                                    </Table>
                                                </TableContainer>
                                            );
                                        })}
                                    </Box>
                                )}

                                <HistogramSelect
                                    binDataList={binDataList}
                                    histogramScale={histogramScale}
                                    setHistogramScale={setHistogramScale}
                                    yAxisMetric={yAxisMetric}
                                    setYAxisMetric={setYAxisMetric}
                                />
                            </Box>
                        )}
                    </Grid>
                </Grid>
            </Container>
            {results.length > 0 && viewMode === 'single' && selectedResultIndices.length > 0 && (
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    mb: 4,
                    flexWrap: 'wrap',
                    gap: 1,
                    maxWidth: '650px'
                }}>
                    <ExportButton
                        text='Export'
                        filename={results[selectedResultIndices[0]].filename}
                        particles={results[selectedResultIndices[0]].particles}
                        binData={binDataList[0]}
                        statistics={results[selectedResultIndices[0]].statistics}
                    />
                </Box>
            )}
        </Box>
    )
}

export default App
