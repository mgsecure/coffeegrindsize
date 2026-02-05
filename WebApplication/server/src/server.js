import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import { registerRoutes } from './routes.js'

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json())
app.use(pinoHttp())

const apiPrefix = '/api'
registerRoutes(app, { prefix: apiPrefix })

const port = process.env.PORT || 4000
const host = '0.0.0.0'

app.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`)
})

export { app }
