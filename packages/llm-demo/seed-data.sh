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
  "aggregateId": "customer-01",
  "command": "CREATE",
  "payload": { "name": "Acme Corporation", "location": "Berlin" }
}'

post_command '{
  "aggregateName": "customer",
  "aggregateId": "customer-02",
  "command": "CREATE",
  "payload": { "name": "TechStart GmbH", "location": "Munich" }
}'

post_command '{
  "aggregateName": "customer",
  "aggregateId": "customer-03",
  "command": "CREATE",
  "payload": { "name": "Global Logistics AG", "location": "Hamburg" }
}'

post_command '{
  "aggregateName": "customer",
  "aggregateId": "customer-04",
  "command": "CREATE",
  "payload": { "name": "Creative Studios", "location": "Vienna" }
}'

post_command '{
  "aggregateName": "customer",
  "aggregateId": "customer-05",
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
  "aggregateId": "order-01",
  "command": "CREATE",
  "payload": { "customerId": "customer-01", "text": "Office Desks (x10)", "value": 450 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-02",
  "command": "CREATE",
  "payload": { "customerId": "customer-01", "text": "Ergonomic Chairs (x10)", "value": 780 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-03",
  "command": "CREATE",
  "payload": { "customerId": "customer-01", "text": "Monitor Stands (x10)", "value": 200 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-04",
  "command": "CREATE",
  "payload": { "customerId": "customer-01", "text": "Laptop Docking Stations (x5)", "value": 600 }
}'
sleep 1

# ---- Orders for TechStart (mixed — some orders) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-05",
  "command": "CREATE",
  "payload": { "customerId": "customer-02", "text": "Development Laptops (x3)", "value": 4500 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-06",
  "command": "CREATE",
  "payload": { "customerId": "customer-02", "text": "Software Licenses", "value": 1200 }
}'
sleep 1

# ---- Orders for Global Logistics (large orders — triggers confirmation) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-07",
  "command": "CREATE",
  "payload": { "customerId": "customer-03", "text": "Warehouse Shelving System", "value": 8500 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-08",
  "command": "CREATE",
  "payload": { "customerId": "customer-03", "text": "Forklift Rental (3 months)", "value": 3200 }
}'
sleep 1

# ---- Orders for Creative Studios (small, diverse orders) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-09",
  "command": "CREATE",
  "payload": { "customerId": "customer-04", "text": "Drawing Tablets (x5)", "value": 750 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-10",
  "command": "CREATE",
  "payload": { "customerId": "customer-04", "text": "Color Calibration Tools", "value": 320 }
}'
sleep 1

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-11",
  "command": "CREATE",
  "payload": { "customerId": "customer-04", "text": "Photography Backdrop Set", "value": 180 }
}'
sleep 1

# ---- One order for DataFlow (single buyer) ----

post_command '{
  "aggregateName": "order",
  "aggregateId": "order-12",
  "command": "CREATE",
  "payload": { "customerId": "customer-05", "text": "Server Rack Equipment", "value": 5600 }
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
