import {Box, Paper, ToggleButton, ToggleButtonGroup, Typography} from '@mui/material'
import React, {useCallback, useState} from 'react'
import {ResponsiveBar} from '@nivo/bar'
import useWindowSize from './util/useWindowSize.jsx'
import BarChartIcon from '@mui/icons-material/BarChart'
import ShowChartIcon from '@mui/icons-material/ShowChart'

export default function Histogram({
                                      binDataList,
                                      histogramScale,
                                      setHistogramScale,
                                      yAxisMetric,
                                      setYAxisMetric
                                  }) {
    if (!binDataList || binDataList.length === 0) return null

    const {isMobile} = useWindowSize()
    // const displayWidth = isMobile ? 350 : 700

    const yAxisLabel = yAxisMetric === 'mass' ? '% Mass' : '% Count'
    const histogramMetric = binDataList[0].histogramMetric
    const xAxisLabel = histogramMetric === 'diameter' ? 'Diameter (mm)' : 'Surface (mm²)'

    // Prepare data for Nivo
    const binCount = binDataList[0].binCounts.length
    const chartData = []

    const [histogramType, setHistogramType] = useState('bar')

    console.log('histogramType', histogramType)

    for (let i = 0; i < binCount; i++) {
        const lowerBound = binDataList[0].bins[i]
        const upperBound = binDataList[0].bins[i + 1]
        const binLabel = `${lowerBound.toFixed(2)}`
        const entry = {
            bin: binLabel,
            lowerBound,
            upperBound
        }
        binDataList.forEach(data => {
            entry[data.id] = yAxisMetric === 'mass' ? data.binPercentages[i] : data.binCountPercentages[i]
        })
        chartData.push(entry)
    }

    console.log('chartData', chartData)
    const keys = binDataList.map(d => d.id)

    const [colors, setColors] = React.useState(['#3072c6', '#95bdf5'])
    const swapColors = useCallback(() => {
        setColors(prevColors => [...prevColors].reverse())
    }, [])

    return (
        <Box sx={{mt: 3, width: '100%'}}>
            <Box sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 1,
                flexWrap: 'wrap',
                gap: 1
            }}>
                <Typography variant='h6'>{yAxisLabel} vs {xAxisLabel}</Typography>
                <Box sx={{display: 'flex', gap: 1}}>
                    <ToggleButtonGroup
                        value={yAxisMetric}
                        exclusive
                        onChange={(e, next) => next && setYAxisMetric(next)}
                        size='small'
                    >
                        <ToggleButton value='mass'>% Mass</ToggleButton>
                        <ToggleButton value='count'>% Count</ToggleButton>
                    </ToggleButtonGroup>
                    <ToggleButtonGroup
                        value={histogramScale}
                        exclusive
                        onChange={(e, next) => next && setHistogramScale(next)}
                        size='small'
                    >
                        <ToggleButton value='log'>Log</ToggleButton>
                        <ToggleButton value='linear'>Linear</ToggleButton>
                    </ToggleButtonGroup>
                    <ToggleButtonGroup
                        value={histogramType}
                        exclusive
                        onChange={(e, next) => next && setHistogramType(next)}
                        size='small'
                    >
                        <ToggleButton value='bar'>
                            <BarChartIcon/>
                        </ToggleButton>
                        <ToggleButton value='line'>
                            <ShowChartIcon/>
                        </ToggleButton>
                    </ToggleButtonGroup>

                </Box>
            </Box>
            <Paper sx={{p: 1, height: 400, width: '100%', minWidth: isMobile ? 350 : 600}}>
                <ResponsiveBar
                    data={chartData}
                    keys={keys}
                    indexBy='bin'
                    margin={{top: 20, right: 20, bottom: 100, left: 60}}
                    padding={0.1}
                    groupMode='grouped'
                    valueScale={{type: 'linear'}}
                    indexScale={{type: 'band', round: true}}
                    colors={colors}
                    borderColor={{from: 'color', modifiers: [['darker', 1.6]]}}
                    axisTop={null}
                    axisRight={null}
                    axisBottom={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: -45,
                        legend: xAxisLabel,
                        legendPosition: 'middle',
                        legendOffset: 50
                    }}
                    axisLeft={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: yAxisLabel,
                        legendPosition: 'middle',
                        legendOffset: -50
                    }}
                    labelSkipWidth={999}
                    labelSkipHeight={999}
                    labelTextColor={{from: 'color', modifiers: [['darker', 1.6]]}}
                    legends={[
                        {
                            dataFrom: 'keys',
                            anchor: 'bottom',
                            direction: 'row',
                            justify: false,
                            translateX: 0,
                            translateY: 90,
                            itemsSpacing: 20,
                            itemWidth: 100,
                            itemHeight: 20,
                            itemDirection: 'left-to-right',
                            itemOpacity: 0.85,
                            symbolSize: 20,
                            onClick: swapColors,
                            effects: [
                                {
                                    on: 'hover',
                                    style: {
                                        itemOpacity: 1
                                    }
                                }
                            ]
                        }
                    ]}
                    role='application'
                    ariaLabel='Nivo bar chart'
                    barAriaLabel={e => e.id + ': ' + e.formattedValue + ' in bin: ' + e.indexValue}
                    tooltip={({id, value, color, data}) => (
                        <Paper sx={{p: 1, border: `1px solid ${color}`}}>
                            <Typography variant='body2' sx={{fontWeight: 'bold', color}}>
                                {id}
                            </Typography>
                            <Typography variant='body2' style={{whiteSpace: 'nowrap'}}>
                                Range: {data.lowerBound.toFixed(2)} - {data.upperBound.toFixed(2)} {histogramMetric === 'diameter' ? 'mm' : 'mm²'}
                            </Typography>
                            <Typography variant='body2'>
                                Value: <strong>{`${value.toFixed(2)}%`}</strong>
                            </Typography>
                        </Paper>
                    )}
                />
            </Paper>
        </Box>
    )
}