import {Box, Paper, ToggleButton, ToggleButtonGroup, Typography, Tooltip} from '@mui/material'
import React from 'react'
import useWindowSize from './util/useWindowSize.jsx'


export default function Histogram({binData, setHistogramScale}) {

    console.log('Rendering Histogram with data:', binData);
    if (!binData) return null;
    const {
        bins,
        binCounts,
        binPercentages,
        histogramScale,
        histogramMetric,
        yAxisMetric,
        setYAxisMetric,
        min,
        max
    } = binData;

    const usePercentages = yAxisMetric === 'mass';
    const dataValues = usePercentages ? binPercentages : binCounts;
    const maxVal = Math.max(...dataValues, usePercentages ? 0.01 : 1);
    
    const yAxisLabel = usePercentages ? '% Mass' : 'Particle Count';
    const xAxisLabel = histogramMetric === 'diameter' ? 'Diameter (mm)' : 'Surface (mm²)';

    const {isMobile} = useWindowSize()
    const displayWidth = isMobile ? 350 : 700

    return (
        <Box sx={{ mt: 3, width: displayWidth }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="h6">{yAxisLabel} vs {xAxisLabel}</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <ToggleButtonGroup
                        value={yAxisMetric}
                        exclusive
                        onChange={(e, next) => next && setYAxisMetric(next)}
                        size="small"
                    >
                        <ToggleButton value="mass">% Mass</ToggleButton>
                        <ToggleButton value="count">Count</ToggleButton>
                    </ToggleButtonGroup>
                    <ToggleButtonGroup
                        value={histogramScale}
                        exclusive
                        onChange={(e, next) => next && setHistogramScale(next)}
                        size="small"
                    >
                        <ToggleButton value="log">Log</ToggleButton>
                        <ToggleButton value="linear">Linear</ToggleButton>
                    </ToggleButtonGroup>
                </Box>
            </Box>
            <Paper sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', height: 225, width: '100%', maxWidth: 800 }}>
                    {/* Y-Axis labels */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pr: 1, borderRight: '1px solid #ccc', minWidth: '40px' }}>
                        <Typography variant="caption" sx={{ lineHeight: 1, textAlign: 'right' }}>{maxVal.toFixed(usePercentages ? 1 : 0)}</Typography>
                        <Typography variant="caption" sx={{ lineHeight: 1, textAlign: 'right' }}>{(maxVal / 2).toFixed(usePercentages ? 1 : 0)}</Typography>
                        <Typography variant="caption" sx={{ lineHeight: 1, textAlign: 'right' }}>0</Typography>
                    </Box>
                    
                    {/* Histogram Bars */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', flex: 1, gap: '1px', ml: 1, position: 'relative' }}>
                        {dataValues.map((val, i) => (
                            <Tooltip 
                                key={i} 
                                title={
                                    <Box>
                                        <Typography variant="caption" display="block">Bin {i}: {bins[i].toFixed(3)} - {bins[i+1].toFixed(3)} {histogramMetric === 'diameter' ? 'mm' : 'mm²'}</Typography>
                                        <Typography variant="caption" display="block">Mass: {binPercentages[i].toFixed(2)}%</Typography>
                                        <Typography variant="caption" display="block">Count: {binCounts[i]}</Typography>
                                    </Box>
                                }
                                arrow
                            >
                                <Box
                                    sx={{
                                        flex: 1,
                                        bgcolor: 'primary.main',
                                        height: `${(val / maxVal) * 100}%`,
                                        minWidth: '2px',
                                        '&:hover': {
                                            bgcolor: 'primary.dark',
                                        }
                                    }}
                                />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>
                
                {/* X-Axis labels */}
                <Box sx={{ display: 'flex', ml: '48px', pt: 1, borderTop: '1px solid #ccc' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    {(() => {
                        const unit = histogramMetric === 'diameter' ? 'mm' : 'mm²';
                        const labels = [];
                        if (histogramScale === 'log') {
                            const logMin = Math.log10(min > 0 ? min : 0.01);
                            const logMax = Math.log10(max);
                            for (let i = 0; i <= 4; i++) {
                                const val = Math.pow(10, logMin + (i/4) * (logMax - logMin));
                                labels.push(<Typography key={i} variant="caption">{val.toFixed(2)}{unit}</Typography>);
                            }
                        } else {
                            for (let i = 0; i <= 4; i++) {
                                const val = min + (i/4) * (max - min);
                                labels.push(<Typography key={i} variant="caption">{val.toFixed(2)}{unit}</Typography>);
                            }
                        }
                        return labels;
                    })()}
                    </Box>
                </Box>
            </Paper>
        </Box>
    )
}