export function beautifyNestoryPrice(rawPrice: number): number {
  if (!Number.isFinite(rawPrice)) {
    return 0;
  }

  const basePrice = Math.max(0, Math.ceil(rawPrice));
  const candidates = [basePrice];
  const tail = basePrice % 10;
  const lastTwoDigits = basePrice % 100;

  candidates.push(tail === 0 ? basePrice : basePrice + (10 - tail));
  candidates.push(tail <= 5 ? basePrice + (5 - tail) : basePrice + (15 - tail));
  candidates.push(lastTwoDigits <= 99 ? basePrice + (99 - lastTwoDigits) : basePrice + 99);

  return Math.min(...candidates.filter((price) => {
    const nextTail = price % 10;
    const nextLastTwoDigits = price % 100;

    return nextTail === 0 || nextTail === 5 || nextLastTwoDigits === 99;
  }));
}
