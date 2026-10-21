/**
 * Browser-only: the ELK web worker (`elkjs/lib/elk-worker.min.js`, the same GWT code as the bundled build) and the
 * api class that talks to it. Imported lazily by `elkRunner.ts`; Vite emits the worker as its own asset file whose URL is
 * relative to this module, so it works under any base path.
 */
import ELK from 'elkjs/lib/elk-api';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';

export const createElkWorker = (): Worker => new ElkWorker();
export { ELK };
