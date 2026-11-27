import { app } from 'electron'
import { config } from 'dotenv'
import { join } from 'node:path'
app.setName('Overlay')
config({ path: join(__dirname, '../../.env') })
