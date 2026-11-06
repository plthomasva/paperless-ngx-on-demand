#!/usr/bin/env bash
# trigger-upgrade.sh
# Remotely triggers an upgrade of Paperless-NGX via AWS Systems Manager (SSM).
# 1. Wakes up the EC2 instance if it is stopped ($0 idle compute)
# 2. Executes /opt/paperless/runtime/upgrade-paperless.sh via SSM Run Command
# 3. Streams execution progress to your local console (zero open SSH ports needed!)

set -euo pipefail

INSTANCE_ID="${1:-}"
AWS_REGION="${2:-us-east-1}"

if [[ -z "$INSTANCE_ID" ]]; then
  echo "Usage: ./trigger-upgrade.sh <ec2-instance-id> [aws-region]"
  echo "Example: ./trigger-upgrade.sh i-0123456789abcdef0 us-east-1"
  exit 1
fi

echo "=== Paperless-NGX Remote Upgrade Orchestrator ==="
echo "Target instance: $INSTANCE_ID ($AWS_REGION)"

# 1. Check current instance state
current_state=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --region "$AWS_REGION" \
  --query "Reservations[0].Instances[0].State.Name" \
  --output text 2>/dev/null || echo "unknown")

echo "Current instance state: $current_state"

if [[ "$current_state" != "running" ]]; then
  echo "Waking up instance for upgrade..."
  aws ec2 start-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION" >/dev/null
  echo "Waiting for instance to reach 'running' state..."
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$AWS_REGION"
fi

# 2. Wait for SSM agent to respond
echo "Waiting for Systems Manager (SSM) agent to become online..."
ssm_ready=false
for _ in {1..30}; do
  ping_status=$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --region "$AWS_REGION" \
    --query "InstanceInformationList[0].PingStatus" \
    --output text 2>/dev/null || echo "")
  if [[ "$ping_status" == "Online" ]]; then
    ssm_ready=true
    break
  fi
  sleep 4
done

if [[ "$ssm_ready" != "true" ]]; then
  echo "Error: SSM agent timed out or is not online on instance $INSTANCE_ID."
  exit 1
fi

echo "SSM agent is online. Sending upgrade command..."

# 3. Send Run Command
command_id=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "Upgrade Paperless-NGX" \
  --parameters 'commands=["/opt/paperless/runtime/upgrade-paperless.sh"]' \
  --region "$AWS_REGION" \
  --query "Command.CommandId" \
  --output text)

echo "Sent command ID: $command_id"
echo "Waiting for upgrade to complete and streaming output..."

# 4. Wait for command completion
aws ssm wait command-executed \
  --command-id "$command_id" \
  --instance-id "$INSTANCE_ID" \
  --region "$AWS_REGION" 2>/dev/null || true

# 5. Fetch stdout and stderr
aws ssm get-command-invocation \
  --command-id "$command_id" \
  --instance-id "$INSTANCE_ID" \
  --region "$AWS_REGION" \
  --query "{Status:Status,StandardOutput:StandardOutputContent,StandardError:StandardErrorContent}" \
  --output yaml

echo "Upgrade command invocation completed."
