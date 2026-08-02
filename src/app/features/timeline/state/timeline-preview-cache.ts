export type CachedPreviewFrame = {
  timestampMs: number;
  imageUrl: string;
  lastAccessMs: number;
};

export class TimelinePreviewCache {
  private readonly entries = new Map<number, CachedPreviewFrame>();

  constructor(private readonly maxEntries: number = 240) {}

  has(timestampMs: number): boolean {
    return this.entries.has(timestampMs);
  }

  set(timestampMs: number, imageUrl: string): void {
    this.entries.set(timestampMs, {
      timestampMs,
      imageUrl,
      lastAccessMs: Date.now()
    });
    this.evictOverflow();
  }

  get(timestampMs: number): string | null {
    const entry = this.entries.get(timestampMs);

    if (!entry) {
      return null;
    }

    entry.lastAccessMs = Date.now();
    return entry.imageUrl;
  }

  nearest(timestampMs: number, toleranceMs: number): string | null {
    let nearestTimestamp: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const candidateTimestamp of this.entries.keys()) {
      const distance = Math.abs(candidateTimestamp - timestampMs);

      if (distance <= toleranceMs && distance < nearestDistance) {
        nearestDistance = distance;
        nearestTimestamp = candidateTimestamp;
      }
    }

    if (nearestTimestamp === null) {
      return null;
    }

    return this.get(nearestTimestamp);
  }

  pruneOutsideRange(startMs: number, endMs: number): void {
    for (const timestampMs of this.entries.keys()) {
      if (timestampMs < startMs || timestampMs > endMs) {
        this.entries.delete(timestampMs);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  private evictOverflow(): void {
    if (this.entries.size <= this.maxEntries) {
      return;
    }

    const sortedByAge = Array.from(this.entries.values()).sort(
      (left, right) => left.lastAccessMs - right.lastAccessMs
    );
    const overflowCount = this.entries.size - this.maxEntries;

    for (const staleEntry of sortedByAge.slice(0, overflowCount)) {
      this.entries.delete(staleEntry.timestampMs);
    }
  }
}
