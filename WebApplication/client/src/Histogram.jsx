import {Box, Paper, ToggleButton, ToggleButtonGroup, Typography} from '@mui/material'
import React from 'react'


export default function Histogram({binData, setHistogramScale, setHistogramMetric}) {

    console.log('Rendering Histogram with data:', binData);
    if (!binData) return null;
    const {
        bins,
        binCounts,
        binPercentages,
        histogramScale,
        histogramMetric,
        maxClusterAxis,
        min,
        max
    } = binData;

    const maxPercentage = Math.max(...binPercentages, 0.01);

    return (
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
    )
}