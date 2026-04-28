// Download Functions

// Lambda Function Code
const lambdaCode = `import boto3
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

rds = boto3.client('rds')

def lambda_handler(event, context):
    action = os.environ.get('ACTION', 'stop')  # 'start' or 'stop'
    tag_key = os.environ.get('TAG_KEY', 'AutoStartStop')
    tag_value = os.environ.get('TAG_VALUE', 'true')
    
    try:
        # Get all RDS instances
        response = rds.describe_db_instances()
        
        for db_instance in response['DBInstances']:
            db_instance_identifier = db_instance['DBInstanceIdentifier']
            db_instance_arn = db_instance['DBInstanceArn']
            db_instance_status = db_instance['DBInstanceStatus']
            
            # Get tags for the instance
            tags_response = rds.list_tags_for_resource(ResourceName=db_instance_arn)
            tags = {tag['Key']: tag['Value'] for tag in tags_response['TagList']}
            
            # Check if instance has the required tag
            if tags.get(tag_key) == tag_value:
                if action == 'stop' and db_instance_status == 'available':
                    logger.info(f"Stopping RDS instance: {db_instance_identifier}")
                    rds.stop_db_instance(DBInstanceIdentifier=db_instance_identifier)
                    
                elif action == 'start' and db_instance_status == 'stopped':
                    logger.info(f"Starting RDS instance: {db_instance_identifier}")
                    rds.start_db_instance(DBInstanceIdentifier=db_instance_identifier)
                else:
                    logger.info(f"Instance {db_instance_identifier} is in {db_instance_status} state. No action taken.")
            else:
                logger.info(f"Instance {db_instance_identifier} does not have required tag. Skipping.")
        
        return {
            'statusCode': 200,
            'body': f'Successfully executed {action} action on tagged RDS instances'
        }
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise e`;

// Terraform Files
const terraformMain = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "RDS-StartStop-Lambda-Role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# IAM Policy
resource "aws_iam_policy" "lambda_policy" {
  name        = "RDS-StartStop-Policy"
  description = "Policy for Lambda to start/stop RDS instances"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "rds:DescribeDBInstances",
          "rds:ListTagsForResource",
          "rds:StartDBInstance",
          "rds:StopDBInstance"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# Attach policy to role
resource "aws_iam_role_policy_attachment" "lambda_policy_attach" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.lambda_policy.arn
}

# Lambda Function - START
data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "\${path.module}/lambda_function.zip"
  
  source {
    content  = file("\${path.module}/lambda_function.py")
    filename = "lambda_function.py"
  }
}

resource "aws_lambda_function" "rds_start" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "RDS-Start-Function"
  role            = aws_iam_role.lambda_role.arn
  handler         = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  runtime         = "python3.11"
  timeout         = 60

  environment {
    variables = {
      ACTION    = "start"
      TAG_KEY   = var.tag_key
      TAG_VALUE = var.tag_value
    }
  }
}

# Lambda Function - STOP
resource "aws_lambda_function" "rds_stop" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "RDS-Stop-Function"
  role            = aws_iam_role.lambda_role.arn
  handler         = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  runtime         = "python3.11"
  timeout         = 60

  environment {
    variables = {
      ACTION    = "stop"
      TAG_KEY   = var.tag_key
      TAG_VALUE = var.tag_value
    }
  }
}

# CloudWatch Event Rule - START
resource "aws_cloudwatch_event_rule" "rds_start_schedule" {
  name                = "RDS-Start-Schedule"
  description         = "Trigger RDS start at 9:30 AM"
  schedule_expression = var.start_cron
}

# CloudWatch Event Target - START
resource "aws_cloudwatch_event_target" "rds_start_target" {
  rule      = aws_cloudwatch_event_rule.rds_start_schedule.name
  target_id = "RDSStartLambda"
  arn       = aws_lambda_function.rds_start.arn
}

# Lambda Permission - START
resource "aws_lambda_permission" "allow_eventbridge_start" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rds_start.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.rds_start_schedule.arn
}

# CloudWatch Event Rule - STOP
resource "aws_cloudwatch_event_rule" "rds_stop_schedule" {
  name                = "RDS-Stop-Schedule"
  description         = "Trigger RDS stop at 6:30 PM"
  schedule_expression = var.stop_cron
}

# CloudWatch Event Target - STOP
resource "aws_cloudwatch_event_target" "rds_stop_target" {
  rule      = aws_cloudwatch_event_rule.rds_stop_schedule.name
  target_id = "RDSStopLambda"
  arn       = aws_lambda_function.rds_stop.arn
}

# Lambda Permission - STOP
resource "aws_lambda_permission" "allow_eventbridge_stop" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rds_stop.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.rds_stop_schedule.arn
}`;

const terraformVariables = `variable "aws_region" {
  description = "AWS Region"
  default     = "us-east-1"
}

variable "tag_key" {
  description = "Tag key to identify RDS instances"
  default     = "AutoStartStop"
}

variable "tag_value" {
  description = "Tag value to identify RDS instances"
  default     = "true"
}

variable "start_cron" {
  description = "Cron expression for start schedule"
  default     = "cron(30 9 ? * MON-FRI *)"  # 9:30 AM Mon-Fri
}

variable "stop_cron" {
  description = "Cron expression for stop schedule"
  default     = "cron(30 18 ? * MON-FRI *)" # 6:30 PM Mon-Fri
}`;

const terraformOutputs = `output "start_lambda_arn" {
  value = aws_lambda_function.rds_start.arn
}

output "stop_lambda_arn" {
  value = aws_lambda_function.rds_stop.arn
}

output "start_schedule_rule" {
  value = aws_cloudwatch_event_rule.rds_start_schedule.name
}

output "stop_schedule_rule" {
  value = aws_cloudwatch_event_rule.rds_stop_schedule.name
}`;

const terraformReadme = `# RDS Start/Stop Automation - Terraform

## Prerequisites
- AWS CLI configured
- Terraform installed (v1.0+)
- Appropriate AWS permissions

## Quick Start

1. Clone or download this directory
2. Create the Lambda function file:
   \`\`\`bash
   # Copy lambda_function.py to this directory
   \`\`\`

3. Initialize Terraform:
   \`\`\`bash
   terraform init
   \`\`\`

4. Review the plan:
   \`\`\`bash
   terraform plan
   \`\`\`

5. Apply the configuration:
   \`\`\`bash
   terraform apply
   \`\`\`

6. Tag your RDS instances:
   \`\`\`bash
   aws rds add-tags-to-resource \\
     --resource-name arn:aws:rds:REGION:ACCOUNT_ID:db:DB_NAME \\
     --tags Key=AutoStartStop,Value=true
   \`\`\`

## Customization

Edit \`variables.tf\` to change:
- AWS Region
- Cron schedules
- Tag keys/values

## Cleanup

\`\`\`bash
terraform destroy
\`\`\`
`;

const bashScript = `#!/bin/bash

# RDS Start/Stop Automation Setup Script
# This script sets up Lambda functions and EventBridge rules for RDS automation

set -e

# Variables
REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_NAME="RDS-StartStop-Lambda-Role"
POLICY_NAME="RDS-StartStop-Policy"

echo "🚀 Starting RDS Start/Stop Automation Setup..."
echo "Region: $REGION"
echo "Account ID: $ACCOUNT_ID"

# Step 1: Create IAM Policy
echo "📝 Creating IAM Policy..."
cat > rds-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "rds:DescribeDBInstances",
                "rds:ListTagsForResource",
                "rds:StartDBInstance",
                "rds:StopDBInstance"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        }
    ]
}
EOF

POLICY_ARN=$(aws iam create-policy \\
  --policy-name $POLICY_NAME \\
  --policy-document file://rds-policy.json \\
  --query 'Policy.Arn' \\
  --output text 2>/dev/null || echo "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}")

echo "✅ Policy created: $POLICY_ARN"

# Step 2: Create IAM Role
echo "📝 Creating IAM Role..."
cat > trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \\
  --role-name $ROLE_NAME \\
  --assume-role-policy-document file://trust-policy.json 2>/dev/null || echo "Role already exists"

# Attach policy to role
aws iam attach-role-policy \\
  --role-name $ROLE_NAME \\
  --policy-arn $POLICY_ARN

echo "✅ IAM Role created and policy attached"
echo "⏳ Waiting for IAM role to propagate..."
sleep 10

# Step 3: Create Lambda deployment package
echo "📦 Creating Lambda deployment package..."
cat > lambda_function.py <<'PYTHON_EOF'
import boto3
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

rds = boto3.client('rds')

def lambda_handler(event, context):
    action = os.environ.get('ACTION', 'stop')
    tag_key = os.environ.get('TAG_KEY', 'AutoStartStop')
    tag_value = os.environ.get('TAG_VALUE', 'true')
    
    try:
        response = rds.describe_db_instances()
        
        for db_instance in response['DBInstances']:
            db_instance_identifier = db_instance['DBInstanceIdentifier']
            db_instance_arn = db_instance['DBInstanceArn']
            db_instance_status = db_instance['DBInstanceStatus']
            
            tags_response = rds.list_tags_for_resource(ResourceName=db_instance_arn)
            tags = {tag['Key']: tag['Value'] for tag in tags_response['TagList']}
            
            if tags.get(tag_key) == tag_value:
                if action == 'stop' and db_instance_status == 'available':
                    logger.info(f"Stopping RDS instance: {db_instance_identifier}")
                    rds.stop_db_instance(DBInstanceIdentifier=db_instance_identifier)
                    
                elif action == 'start' and db_instance_status == 'stopped':
                    logger.info(f"Starting RDS instance: {db_instance_identifier}")
                    rds.start_db_instance(DBInstanceIdentifier=db_instance_identifier)
                else:
                    logger.info(f"Instance {db_instance_identifier} is in {db_instance_status} state.")
            else:
                logger.info(f"Instance {db_instance_identifier} does not have required tag.")
        
        return {
            'statusCode': 200,
            'body': f'Successfully executed {action} action'
        }
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise e
PYTHON_EOF

zip lambda_function.zip lambda_function.py
echo "✅ Lambda package created"

# Step 4: Create Lambda Functions
echo "⚡ Creating Lambda Functions..."
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# Create START function
aws lambda create-function \\
  --function-name RDS-Start-Function \\
  --runtime python3.11 \\
  --role $ROLE_ARN \\
  --handler lambda_function.lambda_handler \\
  --zip-file fileb://lambda_function.zip \\
  --timeout 60 \\
  --environment Variables="{ACTION=start,TAG_KEY=AutoStartStop,TAG_VALUE=true}" \\
  --region $REGION 2>/dev/null || aws lambda update-function-code \\
  --function-name RDS-Start-Function \\
  --zip-file fileb://lambda_function.zip \\
  --region $REGION

echo "✅ START function created"

# Create STOP function
aws lambda create-function \\
  --function-name RDS-Stop-Function \\
  --runtime python3.11 \\
  --role $ROLE_ARN \\
  --handler lambda_function.lambda_handler \\
  --zip-file fileb://lambda_function.zip \\
  --timeout 60 \\
  --environment Variables="{ACTION=stop,TAG_KEY=AutoStartStop,TAG_VALUE=true}" \\
  --region $REGION 2>/dev/null || aws lambda update-function-code \\
  --function-name RDS-Stop-Function \\
  --zip-file fileb://lambda_function.zip \\
  --region $REGION

echo "✅ STOP function created"

# Step 5: Create EventBridge Rules
echo "⏰ Creating EventBridge Rules..."

# START Rule (9:30 AM)
START_RULE_ARN=$(aws events put-rule \\
  --name RDS-Start-Schedule \\
  --schedule-expression "cron(30 9 ? * MON-FRI *)" \\
  --region $REGION \\
  --query 'RuleArn' \\
  --output text)

echo "✅ START schedule created: $START_RULE_ARN"

# STOP Rule (6:30 PM)
STOP_RULE_ARN=$(aws events put-rule \\
  --name RDS-Stop-Schedule \\
  --schedule-expression "cron(30 18 ? * MON-FRI *)" \\
  --region $REGION \\
  --query 'RuleArn' \\
  --output text)

echo "✅ STOP schedule created: $STOP_RULE_ARN"

# Step 6: Add Lambda permissions
echo "🔐 Adding Lambda permissions..."

START_FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:RDS-Start-Function"
STOP_FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:RDS-Stop-Function"

aws lambda add-permission \\
  --function-name RDS-Start-Function \\
  --statement-id AllowEventBridgeInvoke \\
  --action lambda:InvokeFunction \\
  --principal events.amazonaws.com \\
  --source-arn $START_RULE_ARN \\
  --region $REGION 2>/dev/null || echo "Permission already exists"

aws lambda add-permission \\
  --function-name RDS-Stop-Function \\
  --statement-id AllowEventBridgeInvoke \\
  --action lambda:InvokeFunction \\
  --principal events.amazonaws.com \\
  --source-arn $STOP_RULE_ARN \\
  --region $REGION 2>/dev/null || echo "Permission already exists"

echo "✅ Permissions added"

# Step 7: Add targets to rules
echo "🎯 Adding targets to EventBridge rules..."

aws events put-targets \\
  --rule RDS-Start-Schedule \\
  --targets "Id"="1","Arn"="$START_FUNCTION_ARN" \\
  --region $REGION

aws events put-targets \\
  --rule RDS-Stop-Schedule \\
  --targets "Id"="1","Arn"="$STOP_FUNCTION_ARN" \\
  --region $REGION

echo "✅ Targets configured"

# Cleanup temporary files
rm -f rds-policy.json trust-policy.json lambda_function.zip lambda_function.py

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Tag your RDS instances with Key=AutoStartStop, Value=true"
echo "   aws rds add-tags-to-resource \\\\"
echo "     --resource-name arn:aws:rds:${REGION}:${ACCOUNT_ID}:db:YOUR_DB_NAME \\\\"
echo "     --tags Key=AutoStartStop,Value=true"
echo ""
echo "2. Test the functions:"
echo "   aws lambda invoke --function-name RDS-Start-Function response.json"
echo "   aws lambda invoke --function-name RDS-Stop-Function response.json"
echo ""
echo "3. Monitor CloudWatch Logs:"
echo "   aws logs tail /aws/lambda/RDS-Start-Function --follow"
`;

// Download PDF
function downloadPDF() {
    showLoading();
    
    setTimeout(() => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Title
        doc.setFontSize(20);
        doc.setTextColor(35, 47, 62);
        doc.text('RDS Start/Stop Automation Guide', 20, 20);
        
        // Metadata
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 30);
        
        let yPos = 45;
        
        // Content
        doc.setFontSize(12);
        doc.setTextColor(0);
        
        const content = [
            { title: 'Solution Overview', text: 'Tag-based RDS instance automation with Lambda and EventBridge' },
            { title: 'Start Time', text: '9:30 AM (Weekdays)' },
            { title: 'Stop Time', text: '6:30 PM (Weekdays)' },
            { title: 'Tag Key', text: 'AutoStartStop' },
            { title: 'Tag Value', text: 'true' }
        ];
        
        content.forEach(item => {
            doc.setFont(undefined, 'bold');
            doc.text(item.title + ':', 20, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(item.text, 70, yPos);
            yPos += 10;
        });
        
        // Add sections
        yPos += 10;
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('Implementation Steps', 20, yPos);
        
        yPos += 10;
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        
        const steps = [
            '1. Create IAM Role with RDS permissions',
            '2. Create Lambda functions (Start & Stop)',
            '3. Configure EventBridge schedules',
            '4. Tag RDS instances for automation',
            '5. Test and monitor via CloudWatch'
        ];
        
        steps.forEach(step => {
            doc.text(step, 25, yPos);
            yPos += 7;
        });
        
        // Save
        doc.save(`RDS-Automation-Guide-${getFormattedDate()}.pdf`);
        hideLoading();
    }, 500);
}

// Download Word Document
function downloadDOCX() {
    showLoading();
    
    setTimeout(() => {
        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
        
        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        text: "RDS Start/Stop Automation Guide",
                        heading: HeadingLevel.HEADING_1,
                    }),
                    new Paragraph({
                        text: "Complete Solution with Lambda, EventBridge & Terraform",
                        heading: HeadingLevel.HEADING_2,
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: `Generated: ${new Date().toLocaleDateString()}`,
                                italics: true,
                            }),
                        ],
                    }),
                    new Paragraph({ text: "" }),
                    new Paragraph({
                        text: "Solution Overview",
                        heading: HeadingLevel.HEADING_2,
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Start Time: ", bold: true }),
                            new TextRun("9:30 AM (Weekdays)"),
                        ],
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Stop Time: ", bold: true }),
                            new TextRun("6:30 PM (Weekdays)"),
                        ],
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Tag Key: ", bold: true }),
                            new TextRun("AutoStartStop"),
                        ],
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Tag Value: ", bold: true }),
                            new TextRun("true"),
                        ],
                    }),
                    new Paragraph({ text: "" }),
                    new Paragraph({
                        text: "For complete code samples and detailed instructions, please refer to the downloaded Terraform files and Lambda code.",
                    }),
                ],
            }],
        });
        
        Packer.toBlob(doc).then(blob => {
            saveAs(blob, `RDS-Automation-Guide-${getFormattedDate()}.docx`);
            hideLoading();
        });
    }, 500);
}

// Download Terraform Files
function downloadTerraform() {
    showLoading();
    
    setTimeout(() => {
        const zip = new JSZip();
        const terraformFolder = zip.folder("terraform");
        
        terraformFolder.file("main.tf", terraformMain);
        terraformFolder.file("variables.tf", terraformVariables);
        terraformFolder.file("outputs.tf", terraformOutputs);
        terraformFolder.file("lambda_function.py", lambdaCode);
        terraformFolder.file("README.md", terraformReadme);
        
        zip.generateAsync({ type: "blob" }).then(function(content) {
            saveAs(content, `RDS-Terraform-${getFormattedDate()}.zip`);
            hideLoading();
        });
    }, 500);
}

// Download Lambda Code
function downloadLambda() {
    const blob = new Blob([lambdaCode], { type: 'text/x-python' });
    saveAs(blob, 'lambda_function.py');
}

// Download Bash Script
function downloadBashScript() {
    const blob = new Blob([bashScript], { type: 'text/x-sh' });
    saveAs(blob, 'setup-rds-automation.sh');
}

// Download All Files
function downloadAll() {
    showLoading();
    
    setTimeout(() => {
        const zip = new JSZip();
        
        // Terraform folder
        const terraformFolder = zip.folder("terraform");
        terraformFolder.file("main.tf", terraformMain);
        terraformFolder.file("variables.tf", terraformVariables);
        terraformFolder.file("outputs.tf", terraformOutputs);
        terraformFolder.file("README.md", terraformReadme);
        
        // Lambda folder
        const lambdaFolder = zip.folder("lambda");
        lambdaFolder.file("lambda_function.py", lambdaCode);
        
        // Scripts folder
        const scriptsFolder = zip.folder("scripts");
        scriptsFolder.file("setup-rds-automation.sh", bashScript);
        
        // Documentation
        const docsFolder = zip.folder("documentation");
        docsFolder.file("README.txt", "RDS Start/Stop Automation - Complete Package\n\nContents:\n- terraform/ - Terraform IaC files\n- lambda/ - Lambda function code\n- scripts/ - Setup automation script\n\nFor detailed instructions, see the main guide on the website.");
        
        zip.generateAsync({ type: "blob" }).then(function(content) {
            saveAs(content, `RDS-Automation-Complete-${getFormattedDate()}.zip`);
            hideLoading();
        });
    }, 500);
}
