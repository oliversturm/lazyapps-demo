#!/bin/sh
set -e

echo "Initializing Vault for LazyApps encryption..."

# Enable transit secrets engine
vault secrets enable transit 2>/dev/null || echo "Transit engine already enabled"

# Create transit keys for each encryption context
vault write -f transit/keys/personal 2>/dev/null || echo "Key 'personal' already exists"
vault write -f transit/keys/order-details 2>/dev/null || echo "Key 'order-details' already exists"

# Enable AppRole auth method
vault auth enable approle 2>/dev/null || echo "AppRole auth already enabled"

# Create policy for command-processor (encrypt + decrypt all contexts)
vault policy write command-processor - <<EOF
path "transit/encrypt/personal" {
  capabilities = ["update"]
}
path "transit/decrypt/personal" {
  capabilities = ["update"]
}
path "transit/encrypt/order-details" {
  capabilities = ["update"]
}
path "transit/decrypt/order-details" {
  capabilities = ["update"]
}
path "transit/keys/personal" {
  capabilities = ["read"]
}
path "transit/keys/order-details" {
  capabilities = ["read"]
}
path "transit/keys/personal/rotate" {
  capabilities = ["update"]
}
path "transit/keys/order-details/rotate" {
  capabilities = ["update"]
}
EOF

# Create policy for readmodel-customers (decrypt personal context)
vault policy write readmodel-customers - <<EOF
path "transit/decrypt/personal" {
  capabilities = ["update"]
}
path "transit/encrypt/personal" {
  capabilities = ["update"]
}
path "transit/keys/personal" {
  capabilities = ["read"]
}
EOF

# Create policy for readmodel-orders (decrypt both contexts)
vault policy write readmodel-orders - <<EOF
path "transit/decrypt/personal" {
  capabilities = ["update"]
}
path "transit/encrypt/personal" {
  capabilities = ["update"]
}
path "transit/decrypt/order-details" {
  capabilities = ["update"]
}
path "transit/encrypt/order-details" {
  capabilities = ["update"]
}
path "transit/keys/personal" {
  capabilities = ["read"]
}
path "transit/keys/order-details" {
  capabilities = ["read"]
}
EOF

# Create AppRole roles for each service
vault write auth/approle/role/command-processor \
  token_policies="command-processor" \
  token_ttl=1h \
  token_max_ttl=4h

vault write auth/approle/role/readmodel-customers \
  token_policies="readmodel-customers" \
  token_ttl=1h \
  token_max_ttl=4h

vault write auth/approle/role/readmodel-orders \
  token_policies="readmodel-orders" \
  token_ttl=1h \
  token_max_ttl=4h

# Set custom role IDs (matching compose.yml env vars)
vault write auth/approle/role/command-processor/role-id \
  role_id="command-processor-role-id"

vault write auth/approle/role/readmodel-customers/role-id \
  role_id="readmodel-customers-role-id"

vault write auth/approle/role/readmodel-orders/role-id \
  role_id="readmodel-orders-role-id"

# Generate secret IDs (matching compose.yml env vars)
vault write -f auth/approle/role/command-processor/custom-secret-id \
  secret_id="command-processor-secret-id"

vault write -f auth/approle/role/readmodel-customers/custom-secret-id \
  secret_id="readmodel-customers-secret-id"

vault write -f auth/approle/role/readmodel-orders/custom-secret-id \
  secret_id="readmodel-orders-secret-id"

echo "Vault initialization complete!"
echo "Transit keys: personal, order-details"
echo "AppRole roles: command-processor, readmodel-customers, readmodel-orders"
