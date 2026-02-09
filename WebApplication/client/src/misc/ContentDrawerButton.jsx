import React, {useCallback, useState} from 'react'
import Drawer from '@mui/material/Drawer'
import useWindowSize from '../util/useWindowSize.jsx'
import {useTheme} from '@mui/material/styles'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import {Button} from '@mui/material'
import ReactMarkdown from 'react-markdown'
import rehypeExternalLinks from 'rehype-external-links'
import remarkGfm from 'remark-gfm'
import helpSettings from '../resources/helpSettings.md?raw'
import IconButton from '@mui/material/IconButton'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'

export default function ContentDrawerButton({}) {
    const {isMobile} = useWindowSize()
    const theme = useTheme()

    const [open, setOpen] = useState(false)
    const handleOpen = useCallback(() => {
        setOpen(true)
    }, [setOpen])

    const handleClose = useCallback(() => {
        document.activeElement.blur()
        setOpen(false)
    }, [setOpen])

    return (
        <React.Fragment>
            <IconButton onClick={handleOpen} sx={{cursor: 'pointer'}} size='small' aria-label='help' color='inherit'>
                <HelpOutlineIcon fontSize='small'/>
            </IconButton>

            <Drawer
                elevation={12}
                anchor='left'
                open={open}
                onClose={handleClose}
                slotProps={{
                    paper: {sx: {backgroundColor: theme.palette.text.paper, width: isMobile ? '90vw' : 'unset'}},
                    transition: {
                        direction: 'right'
                    }
                }}
                sx={{backgroundColor: '#00000022'}}>
                {open &&
                    <>
                        <div style={{
                            display: 'flex',
                            padding: '15px 15px',
                            height: 64,
                            backgroundColor: theme.palette.card?.add
                        }} onClick={() => setOpen(false)}>

                            <div
                                style={{
                                    flexGrow: 1,
                                    fontSize: '1.5rem',
                                    fontWeight: 500,
                                    color: theme.palette.text.primary
                                }}>
                                Help
                            </div>
                            <div onClick={handleClose}>
                                <HighlightOffIcon sx={{cursor: 'pointer', color: theme.palette.text.primary}}/>
                            </div>
                        </div>

                        <div style={{
                            display: 'flex',
                            padding: '15px 15px',
                            flexDirection: 'column',
                            width: '90%',
                        }}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeExternalLinks, {
                                target: '_blank',
                                rel: ['nofollow', 'noopener', 'noreferrer']
                            }]]}>
                                {String(helpSettings)}
                            </ReactMarkdown>
                        </div>

                    </>
                }
            </Drawer>
        </React.Fragment>
    )
}