# Agendamento

Sistema de agendamento de serviços: cadastro de serviços e profissionais, expediente semanal,
consulta de horários livres e reservas sem conflito. Node.js ≥ 22.13, sem dependências externas
(usa `node:sqlite`, `node:http` e `node:test`).

## Uso

```sh
npm start        # http://localhost:3000  (DB_PATH e PORT configuráveis)
npm test
```

## API

| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/api/services` | `{ name, durationMin, priceCents }` |
| GET/POST | `/api/professionals` | `{ name }` |
| PUT | `/api/professionals/:id/hours` | `{ hours: [{ weekday: 0-6, start: "HH:MM", end: "HH:MM" }] }` (0 = domingo) |
| GET | `/api/availability?professionalId&serviceId&date=YYYY-MM-DD` | horários livres (passo de 15 min) |
| GET | `/api/appointments?date&professionalId` | lista agendamentos |
| POST | `/api/appointments` | `{ professionalId, serviceId, startAt: "YYYY-MM-DDTHH:MM", clientName, clientPhone }` |
| DELETE | `/api/appointments/:id` | cancela (libera o horário) |

Regras: o agendamento deve caber inteiro no expediente, não pode estar no passado nem sobrepor
outro agendamento ativo do mesmo profissional (409). Horários são "relógio local" do estabelecimento.

Exemplo de cadastro inicial:

```sh
curl -XPOST localhost:3000/api/services -H 'content-type: application/json' -d '{"name":"Corte","durationMin":30,"priceCents":5000}'
curl -XPOST localhost:3000/api/professionals -H 'content-type: application/json' -d '{"name":"Ana"}'
curl -XPUT localhost:3000/api/professionals/1/hours -H 'content-type: application/json' -d '{"hours":[{"weekday":1,"start":"09:00","end":"18:00"}]}'
```
