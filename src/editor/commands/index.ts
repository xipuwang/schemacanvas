/** Importing this module registers every editor command (edit / view / arrange / layout / tool). Idempotent. */
import './edit';
import './view';
import './arrange';
import './layout';
import './tool';

export { computePasteOffset } from './edit';
