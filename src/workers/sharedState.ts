/// <reference lib="es2017.sharedmemory" />

/**
 * Shared worker coordination helpers.
 *
 * `SharedArrayBuffer` only exists in cross-origin isolated contexts, which need COOP/COEP
 * response headers. Static hosts such as GitHub Pages cannot send them, so anything shared
 * with workers has to be optional and degrade gracefully.
 */

/** Creates the token to share with workers, or undefined when shared memory is unavailable. */
export function createSharedState(): SharedArrayBuffer | undefined {
    return typeof SharedArrayBuffer === "undefined"
        ? undefined
        : new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT);
}

/**
 * Distributes work across workers.
 *
 * With shared memory available, workers atomically claim the next chunk, so faster workers
 * naturally take more. Without it, each worker is given a fixed slice of the input instead.
 */
export function createWorkCoordinator(
    state: SharedArrayBuffer | undefined,
    total: number,
    batchSize: number,
    workerIndex?: number,
    workerCount?: number,
) {
    const counter = state ? new Uint32Array(state) : undefined;

    // `batchSize` is also used as the amount logged per completed chunk.
    const scale = batchSize;

    // Dynamic claim loop: atomically reserve the next chunk of work.
    const nextClaim = {
        *chunks(): Generator<[number, number]> {
            for (;;) {
                const start = Atomics.add(counter!, 0, scale);
                if (start >= total) {
                    return;
                }

                yield [start, Math.min(start + scale, total)];
            }
        },
    };

    if (counter && (workerIndex === undefined || workerCount === undefined)) {
        return nextClaim;
    }

    // Static fallback: this worker handles one contiguous slice.
    const index = workerIndex ?? 0;
    const count = Math.max(1, workerCount ?? 1);
    const perWorker = Math.ceil(total / count);
    const sliceStart = index * perWorker;
    const sliceEnd = Math.min(sliceStart + perWorker, total);

    return {
        *chunks(): Generator<[number, number]> {
            for (let start = sliceStart; start < sliceEnd; start += scale) {
                yield [start, Math.min(start + scale, sliceEnd)];
            }
        },
    };
}
