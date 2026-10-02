export function SummaryBoard({
  figures,
  caption,
  headers,
  rows
}: {
  figures: Array<{ label: string; value: string }>
  caption?: string
  headers: string[]
  rows: string[][]
}) {
  return (
    <section className="summary-board">
      <div className="summary-figures">
        {figures.map((figure) => (
          <article className="summary-figure" key={figure.label}>
            <span>{figure.label}</span>
            <strong>{figure.value}</strong>
          </article>
        ))}
      </div>
      {caption ? <p className="hint summary-caption">{caption}</p> : null}
      {rows.length > 0 ? (
        <table className="summary-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) => (
                  <td key={`${row[0]}-${headers[index] ?? index}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
