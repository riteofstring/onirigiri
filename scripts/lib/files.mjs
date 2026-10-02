export function isTestFile(relativePath) {
  return (
    /(?:^|[\\/])(?:tests|__tests__)[\\/]/.test(relativePath) ||
    /\.(?:test|spec)\./.test(relativePath)
  );
}
