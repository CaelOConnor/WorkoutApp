import { Router, type Request, type Response } from 'express';

const healthRouter = Router();

healthRouter.get('/', (req: Request, res: Response<string>) => {
  res.send('WorkoutApp API is alive');
});

export default healthRouter;
