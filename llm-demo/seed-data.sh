#!/bin/bash
# Seed data for llm-demo presentations
# Usage: ./seed-data.sh [COMMAND_URL]

COMMAND_URL="${1:-http://commands.localhost/api/command}"

post_command() {
  curl -s -X POST "$COMMAND_URL" \
    -H "Content-Type: application/json" \
    -d "$1" > /dev/null
  echo "  Sent: $(echo "$1" | jq -r '.command') $(echo "$1" | jq -r '.aggregateName') $(echo "$1" | jq -r '.payload.name // .payload.text // ""')"
}

echo "=== LLM Demo: Seeding data ==="
echo ""

# ---- Customers ----

echo "Creating customers..."

post_command '{
  "aggregateName": "customer",
  "aggregateId": "c0000001-0000-4000-8000-000000000001",
  "command": "CREATE",
  "payload": { "name": "Acme Corporation", "location": "Berlin" }
}'

post_command '{
  "aggregateName": "customer",
  "aggregateId": "c0000001-0000-4000-8000-000000000002",
  "command": "CREATE",
  "payload": { "name": "TechStart GmbH", "location": "Munich" }
}'

post_command '{
  "aggregateName": "customer",
  "aggregateId": "c0000001-0000-4000-8000-000000000003",
  "command": "CREATE",
  "payload": { "name": "Global Logistics AG", "location": "Hamburg" }
}'

post_command '{
  "aggregateName": "customer",
  "aggregateId": "c0000001-0000-4000-8000-000000000004",
  "command": "CREATE",
  "payload": { "name": "Creative Studios", "location": "Vienna" }
}'

post_command '{
  "aggregateName": "customer",
  "aggregateId": "c0000001-0000-4000-8000-000000000005",
  "command": "CREATE",
  "payload": { "name": "DataFlow Solutions", "location": "Zurich" }
}'

echo ""
echo "Creating orders..."

# Allow time for customer events to propagate
sleep 2

# ---- Orders for Acme (loyal customer — many confirmed orders → "good" reputation) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000001",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000001", "text": "Office Desks (x10)", "value": 450 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000002",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000001", "text": "Ergonomic Chairs (x10)", "value": 780 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000003",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000001", "text": "Monitor Stands (x10)", "value": 200 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000004",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000001", "text": "Laptop Docking Stations (x5)", "value": 600 }
}'
sleep 1

# ---- Orders for TechStart (mixed — some orders) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000005",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000002", "text": "Development Laptops (x3)", "value": 4500 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000006",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000002", "text": "Software Licenses", "value": 1200 }
}'
sleep 1

# ---- Orders for Global Logistics (large orders — triggers confirmation) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000007",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000003", "text": "Warehouse Shelving System", "value": 8500 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000008",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000003", "text": "Forklift Rental (3 months)", "value": 3200 }
}'
sleep 1

# ---- Orders for Creative Studios (small, diverse orders) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000009",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000004", "text": "Drawing Tablets (x5)", "value": 750 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000010",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000004", "text": "Color Calibration Tools", "value": 320 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000011",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000004", "text": "Photography Backdrop Set", "value": 180 }
}'
sleep 1

# ---- One order for DataFlow (single buyer) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "o0000001-0000-4000-8000-000000000012",
  "command": "CREATE",
  "payload": { "customerId": "c0000001-0000-4000-8000-000000000005", "text": "Server Rack Equipment", "value": 5600 }
}'

echo ""
echo "=== Seed data complete ==="
echo ""
echo "Customers: 5 created"
echo "Orders: 12 created"
echo ""
echo "Expected reputation outcomes (with LLM_MOCK=true):"
echo "  Acme Corporation:   4 orders → may trigger 'good' reputation after 3 confirmed"
echo "  TechStart GmbH:     2 orders → 'neutral' (insufficient history)"
echo "  Global Logistics:   2 orders → 'neutral', high values trigger confirmation"
echo "  Creative Studios:   3 orders → may reach 'good' threshold"
echo "  DataFlow Solutions: 1 order → 'neutral' (single order)"
