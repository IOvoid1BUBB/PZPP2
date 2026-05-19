const WATERFALL = [
  { label: "Przychód", value: 1260, type: "positive" as const },
  { label: "Koszt paliwa", value: -380, type: "negative" as const },
  { label: "Myto", value: -210, type: "negative" as const },
  { label: "Koszty stopu", value: -90, type: "negative" as const },
  { label: "Koszt kierowcy", value: -150, type: "negative" as const },
  { label: "Zysk", value: 430, type: "profit" as const },
];

const MAX = 1260;

export function ProfitWaterfall() {
  return (
    <section className="profit-waterfall" aria-label="Podsumowanie finansowe">
      <div className="profit-waterfall__chart">
        {WATERFALL.map((item) => {
          const height = `${Math.max(8, (Math.abs(item.value) / MAX) * 100)}%`;
          return (
            <div key={item.label} className="profit-waterfall__column">
              <div
                className={`profit-waterfall__bar profit-waterfall__bar--${item.type}`}
                style={{ height }}
              />
              <span className="profit-waterfall__value">
                {item.value > 0 ? "+" : ""}
                {item.value} EUR
              </span>
              <span className="profit-waterfall__label">{item.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
