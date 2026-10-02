export const minimumPaneHeightPx = 96;

export function distributePaneHeights(
  stackHeightPx: number,
  weights: readonly number[],
): number[] {
  if (weights.length === 0) {
    return [];
  }

  const targetHeight = Math.max(
    minimumPaneHeightPx * weights.length,
    Math.round(Number.isFinite(stackHeightPx) ? stackHeightPx : 0),
  );
  return allocateMinimumConstrainedHeights(
    targetHeight,
    weights.map(normalizedResizeWeight),
  );
}

function allocateMinimumConstrainedHeights(
  targetHeight: number,
  normalizedWeights: readonly number[],
): number[] {
  const allocations = Array<number>(normalizedWeights.length).fill(0);
  let remainingHeight = targetHeight;
  let remainingIndexes = normalizedWeights.map((_weight, index) => index);

  while (remainingIndexes.length > 0) {
    const remainingWeight = remainingIndexes.reduce(
      (total, index) => total + arrayValue(normalizedWeights, index),
      0,
    );
    const constrainedIndexes = remainingIndexes.filter(
      (index) =>
        (remainingHeight * arrayValue(normalizedWeights, index)) /
          remainingWeight <
        minimumPaneHeightPx,
    );
    if (constrainedIndexes.length === 0) {
      for (const index of remainingIndexes) {
        allocations[index] =
          (remainingHeight * arrayValue(normalizedWeights, index)) /
          remainingWeight;
      }
      break;
    }

    const constrained = new Set(constrainedIndexes);
    for (const index of constrainedIndexes) {
      allocations[index] = minimumPaneHeightPx;
      remainingHeight -= minimumPaneHeightPx;
    }
    remainingIndexes = remainingIndexes.filter(
      (index) => !constrained.has(index),
    );
  }

  return roundPaneAllocations(targetHeight, allocations);
}

function roundPaneAllocations(
  targetHeight: number,
  allocations: readonly number[],
): number[] {
  const rounded = allocations.map((height) => Math.floor(height));
  const remainingPixels =
    targetHeight - rounded.reduce((total, height) => total + height, 0);
  const fractionalIndexes = allocations
    .map((height, index) => ({ fraction: height - Math.floor(height), index }))
    .toSorted(
      (left, right) =>
        right.fraction - left.fraction || left.index - right.index,
    );

  for (let index = 0; index < remainingPixels; index += 1) {
    const allocation = arrayValue(
      fractionalIndexes,
      index % fractionalIndexes.length,
    );
    rounded[allocation.index] = arrayValue(rounded, allocation.index) + 1;
  }

  return rounded;
}

function normalizedResizeWeight(weight: number): number {
  return Number.isFinite(weight) ? Math.max(0.1, weight) : 1;
}

function arrayValue<Value>(values: readonly Value[], index: number): Value {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`missing pane allocation at ${index}`);
  }
  return value;
}
