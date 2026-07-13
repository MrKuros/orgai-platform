import { Router } from 'express';
import * as path from 'path';

export const setupRouter = Router();

// GET /setup.sh → serves the auto-setup script
setupRouter.get('/setup.sh', (req, res) => {
  res.type('text/plain').sendFile(path.resolve(__dirname, '../setup.sh'));
});

// GET /hook/pre-commit → serves the git pre-commit hook (setup.sh installs it).
// Kept byte-identical to selfhost/hooks/pre-commit — sync when that changes.
setupRouter.get('/hook/pre-commit', (req, res) => {
  res.type('text/plain').sendFile(path.resolve(__dirname, '../hooks/pre-commit'));
});
