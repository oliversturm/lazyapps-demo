#!/usr/bin/env bash

cat <<'EOF'
# Token acquisition helpers — obtain JWT from Keycloak and store in a variable.
# Usage: run the abbreviation, then use $token in subsequent commands.
abbr demo-token-alice 'set -gx token (http --form POST http://keycloak.localhost/realms/lazyapps-demo/protocol/openid-connect/token grant_type=password client_id=lazyapps-frontend username=alice password=alice | jq -r .access_token); echo "Token acquired for alice"'

abbr demo-token-bob 'set -gx token (http --form POST http://keycloak.localhost/realms/lazyapps-demo/protocol/openid-connect/token grant_type=password client_id=lazyapps-frontend username=bob password=bob | jq -r .access_token); echo "Token acquired for bob"'

abbr demo-token 'set -gx token (http --form POST http://keycloak.localhost/realms/lazyapps-demo/protocol/openid-connect/token grant_type=password client_id=lazyapps-frontend username=$argv[1] password=$argv[1] | jq -r .access_token); echo "Token acquired for $argv[1]"'

abbr demo-create-customer 'http POST http://localhost/api/command Host:commands.localhost Authorization:"Bearer $token" aggregateName=customer aggregateId=customer-1 command=CREATE payload[name]="Peter Smith" payload[location]=Somewhere'

abbr demo-create-order 'http POST http://localhost/api/command Host:commands.localhost Authorization:"Bearer $token" aggregateName=order aggregateId=order-1 command=CREATE payload[customerId]=customer-1 payload[text]="Rubber chicken" payload[value]=13.99'

abbr demo-query-customers 'http GET http://localhost/query/overview/all Host:rm-customers.localhost'

abbr demo-query-orders 'http GET http://localhost/query/overview/all Host:rm-orders.localhost'

abbr demo-modify-customer 'http POST http://localhost/api/command Host:commands.localhost Authorization:"Bearer $token" aggregateName=customer aggregateId=customer-1 command=UPDATE payload[name]="Peter Smith (changed externally)"'

# Create customers for all Keycloak users (aggregate ID = user sub).
# This populates the demo with one customer per user, enabling self-access
# testing where each user can see their own data but not others' PII.
# Each user obtains their own token to authenticate the request.
abbr demo-create-all-customers 'for pair in "alice a1b2c3d4-e5f6-7890-abcd-ef1234567001 Alice Anderson" "bob a1b2c3d4-e5f6-7890-abcd-ef1234567002 Bob Baker" "carol a1b2c3d4-e5f6-7890-abcd-ef1234567003 Carol Chen" "dave a1b2c3d4-e5f6-7890-abcd-ef1234567004 Dave Davis" "eve a1b2c3d4-e5f6-7890-abcd-ef1234567005 Eve Evans" "frank a1b2c3d4-e5f6-7890-abcd-ef1234567006 Frank Fisher" "grace a1b2c3d4-e5f6-7890-abcd-ef1234567007 Grace Green" "heidi a1b2c3d4-e5f6-7890-abcd-ef1234567008 Heidi Hall" "ivan a1b2c3d4-e5f6-7890-abcd-ef1234567009 Ivan Ito" "judy a1b2c3d4-e5f6-7890-abcd-ef1234567010 Judy Jones"; set -l parts (string split " " $pair); set -l user_token (http --form POST http://keycloak.localhost/realms/lazyapps-demo/protocol/openid-connect/token grant_type=password client_id=lazyapps-frontend username=$parts[1] password=$parts[1] | jq -r .access_token); http POST http://localhost/api/command Host:commands.localhost Authorization:"Bearer $user_token" aggregateName=customer aggregateId=$parts[2] command=CREATE payload[name]="$parts[3] $parts[4]" payload[location]="City-$parts[3]"; end'

EOF
