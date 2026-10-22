import {
  NO_DATA,
  formatCoordinates,
  formatCourse,
  formatSource,
  formatSpeed,
  formatTime,
  type Vessel,
} from "./vessel";

// Усі значення - текстові вузли React: назва не інтерпретується як HTML.
export default function VesselCard({ vessel }: { vessel: Vessel }) {
  return (
    <section className="vessel-card">
      <dl>
        <dt>Ідентифікатор</dt>
        <dd>{vessel.id}</dd>
        <dt>Назва</dt>
        <dd>{vessel.name ?? NO_DATA}</dd>
        <dt>Координати</dt>
        <dd>{formatCoordinates(vessel.lat, vessel.lon)}</dd>
        <dt>Швидкість</dt>
        <dd>{formatSpeed(vessel.speedKnots)}</dd>
        <dt>Курс</dt>
        <dd>{formatCourse(vessel.courseDeg)}</dd>
        <dt>Час повідомлення</dt>
        <dd>{formatTime(vessel.timestamp)}</dd>
        <dt>Джерело</dt>
        <dd>{formatSource(vessel.source)}</dd>
      </dl>
    </section>
  );
}
