import { generateSummary } from './tasks/generate-summary';
import 'dotenv/config';

(async () => {
  const result = await generateSummary('a0BIj0000026Rc8MAE');

  console.log(result);
})();
