import { Router } from 'express';
import * as path from 'path';

export const setupRouter = Router();

// GET /setup.sh → serves the auto-setup script
setupRouter.get('/setup.sh', (req, res) => {
  res.type('text/plain').sendFile(path.resolve(__dirname, '../setup.sh'));
});