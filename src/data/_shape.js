// A registry row may promise the columns the pages read and the fewest rows a healthy
// result has. A result that breaks it fails the build, so a deploy that would show an
// empty or changed dashboard stops, and the last good site stays up. The columns of an
// empty result cannot be read, so a row that lists columns needs at least one.
export function checkShape({name, columns = [], minRows = 0}, rows) {
  const fewest = Math.max(minRows, columns.length ? 1 : 0);
  if (rows.length < fewest) throw new Error(`${name}: ${rows.length} ${rows.length === 1 ? "row" : "rows"}, fewer than the ${fewest} it must have`);
  const missing = rows.length ? columns.filter((column) => !(column in rows[0])) : [];
  if (missing.length) throw new Error(`${name}: the result lacks the columns ${missing.join(", ")}`);
}
