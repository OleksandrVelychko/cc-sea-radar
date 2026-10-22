# PROVENANCE — position-report.sample.json

## Походження зразка
- **Зразок синтетичний: не отриманий із живого джерела.** Усі значення вигадані 2026-10-23. MMSI `123456789` і назва `SYNTHETIC SAMPLE` — умовні; на належність реальному судну не перевірялись.
- Структура (назви полів, регістр, вкладеність, порядок і типи JSON) повторює живий `PositionReport`, отриманий 2026-10-22 (див. «Результат живої перевірки»). Полів, яких не було в живому повідомленні, у зразку немає.
- Приклад з документації AISStream як джерело зразка не взято: він не містить `time_utc`, а координати в ньому лежать в іншому місці (див. «Відмінності»).
- Чого зразок не моделює: розбіжності координат між `MetaData` і `Message.PositionReport` (у живому повідомленні вона була, величина не вимірювалась; у зразку значення однакові) і реальних меж значень полів.
- У зразок і цей файл не включено ключ, handshake, об'єкт підписки й заголовки.

## Чому не збережено живе повідомлення
Умови використання AISStream **не знайдено / не підтверджено** (перевірено 2026-10-23). Це не твердження про встановлену заборону — дозволу на збереження й поширення просто не знайдено.
- https://aisstream.io/documentation — умов, ліцензії, правил зберігання чи поширення немає;
- https://aisstream.io/ — посилання на умови немає; сервіс описано як безкоштовний;
- https://aisstream.io/privacypolicy — про дані AIS нічого, дати редакції немає;
- https://aisstream.io/terms — HTTP 404;
- https://github.com/aisstream (репозиторії `ais-message-models`, `example`, `aisstream`) — файлу LICENSE немає.

Живу відповідь після розбору структури видалено; у репозиторій вона не потрапляла.

## Результат живої перевірки
- **Час (UTC):** запит 2026-10-22 21:59:07Z, відповідь 21:59:11Z (HTTP 200 за 3.3 с).
- **Район:** `AREA_BOUNDS` з `app/config.ts` — 50.75° N, 0.95° E … 51.25° N, 1.95° E (Дуврська протока); запитувались тільки повідомлення типу `PositionReport`.
- **Як:** один локальний `GET /api/snapshot` (`npm run dev`, коміт `020f6d0`, Node 24.21.0) після review серверного коду користувачем.
- **З'єднання відкрилося:** так — за результатом reader (`ok: true` з повідомленням можливий тільки після відкриття й надсилання підписки).
- **Отримано `PositionReport`:** так — `raw.MessageType = "PositionReport"`; позиція з `Message.PositionReport` у районі; між `time_utc` і `collectedAt` 2.9 с.
- **Не перевірено:** чи надійшов `SubscriptionConfirmation` (reader пропускає службові повідомлення, не фіксуючи їх); чи увімкнулося стиснення (`CompressionEnabled`); поведінка на невалідному ключі.
- **Обсяг доказів:** одне повідомлення одного судна.

### Поля живого повідомлення
| Поле | Тип JSON | Примітка |
|---|---|---|
| `MetaData.MMSI` | number | дорівнює `Message.PositionReport.UserID` |
| `MetaData.MMSI_String` | number | попри назву — число; дорівнює `MMSI` |
| `MetaData.ShipName` | string | непорожній |
| `MetaData.latitude`, `MetaData.longitude` | number | малими літерами; не дорівнюють точно координатам `Message.PositionReport` |
| `MetaData.time_utc` | string | шаблон `DDDD-DD-DD DD:DD:DD.DDDDDDDD +DDDD UTC`, **8** цифр дробової частини; розбирається до мілісекунд |
| `MessageType` | string | `"PositionReport"` |
| `Message.PositionReport.MessageID`, `RepeatIndicator`, `UserID`, `NavigationalStatus`, `RateOfTurn`, `TrueHeading`, `Timestamp`, `SpecialManoeuvreIndicator`, `Spare`, `CommunicationState` | number | |
| `Message.PositionReport.Sog` | number | у [0, 102.2] |
| `Message.PositionReport.Cog` | number | у [0, 360) |
| `Message.PositionReport.Latitude`, `Longitude` | number | у районі |
| `Message.PositionReport.Valid`, `PositionAccuracy`, `Raim` | boolean | |

Порядок верхнього рівня: `MetaData`, `MessageType`, `Message`.

## Відмінності
### Від документації (https://aisstream.io/documentation, переглянуто 2026-10-23)
- `MetaData.time_utc` є; у документації його немає.
- `MetaData.latitude/longitude` — малими літерами; у документації `Latitude/Longitude`.
- `Message.PositionReport.Latitude/Longitude` є; у прикладі документації їх немає (у таблиці схеми є).
- `MetaData.MMSI_String` (number) є; у документації немає.
- У прикладі документації `Message.PositionReport` має тільки `MessageID`, `UserID`, `Sog`, `Cog`, `TrueHeading`, `Valid`; живе повідомлення містить усі поля схеми, включно зі `Spare` і `CommunicationState`.

### Від SPRINT-02
- `time_utc`: у спринті приклад з 9 цифрами дробової частини, живе — 8. Довжина дробової частини, ймовірно, змінна.
- `MMSI_String` спринтом не згадується; `MMSI` — число, `id` має бути рядком.
- Решта полів, з яких спринт бере дані (`MMSI`, `ShipName`, `time_utc`, `Message.PositionReport.Latitude/Longitude/Sog/Cog`), є, з очікуваним регістром.
- Твердження спринту «підтвердження підписки джерело не надсилає» живою перевіркою не підтверджено й не спростовано; документація описує `SubscriptionConfirmation`. Reader B-09 його пропускає (адаптація, погоджена 2026-10-23).

## Наслідки для перетворювача (B-11)
Нормалізація контракту SPRINT-02 з живим форматом **можлива**; зміни контракту не потрібні. Вимоги, що випливають зі спостережень:
- `time_utc` розбирати з дробовою частиною будь-якої довжини (зокрема 8 і 9 цифр) і зсувом `+HHMM`, обрізаючи до мілісекунд; не парсити напряму через `Date`.
- `id` = `String(MetaData.MMSI)`; `MMSI_String` не використовувати (це число, а не рядок).
- Координати брати з `Message.PositionReport`, як вимагає спринт, а не з `MetaData` — значення різняться.
- Якщо `time_utc` у повідомленні відсутній або не парситься — позиція відкидається (правило валідації спринту «час має парситися»); час отримання чи `PositionReport.Timestamp` не підставляються.
- Наявність `time_utc` у кожному повідомленні доведена одним повідомленням, не загалом.
