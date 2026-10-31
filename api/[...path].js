// Single Vercel serverless function that serves every /api/* route (keeps within plan function limits).
import { handle } from '../server/router.js'
export default handle
