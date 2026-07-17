module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // Drizzle-Migrationen: .sql-Dateien werden als Strings gebundelt
      ['inline-import', { extensions: ['.sql'] }],
    ],
  };
};
