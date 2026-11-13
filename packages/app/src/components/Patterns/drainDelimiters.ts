// Python's string.punctuation, the extra delimiters of the app's miner.
// Anything that splits bodies or templates the way the miner did (the denoise
// matcher, pattern filters) must use the same list.
export const DRAIN_EXTRA_DELIMITERS =
  '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split('');
