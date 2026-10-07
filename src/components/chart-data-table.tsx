/** Screen-reader alternative for a chart: the same points as a plain data table. */
export function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: readonly [string, string];
  rows: readonly (readonly [string, string])[];
}) {
  return (
    // A visually hidden wrapper: overflow clipping does not apply to table boxes themselves.
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{columns[0]}</th>
            <th scope="col">{columns[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, value], index) => (
            <tr key={`${key}-${index}`}>
              <th scope="row">{key}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const CHART_KEYBOARD_HINT =
  "Enfoca el gráfico y usa las flechas izquierda y derecha para recorrer los puntos.";
