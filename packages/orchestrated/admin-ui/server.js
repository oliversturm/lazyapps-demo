import express from 'express';
import { handler } from '@lazyapps/admin-ui/build/handler.js';

const port = process.env.PORT || 3000;
const app = express();
app.use(handler);
app.listen(port, '0.0.0.0', () => {
  console.log(`Admin UI listening on port ${port}`);
});
