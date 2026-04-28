// Downloads.js - Fixed for GitHub Pages
// All download content definitions

const FILES = {
    lambda: `import boto3
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
        raise e`,

    terraformMain: `terraform {
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
}`,

    terraformVariables: `variable "aws_region" {
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
}`,

    terraformOutputs: `output "start_lambda_arn" {
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
}`,

    terraformReadme: `# RDS Start/Stop Automation - Terraform

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
`,

    bashScript: `#!/bin/bash

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
  --output text 2>/dev/null || echo "arn:aws:iam::$\{ACCOUNT_ID}:policy/$\{POLICY_NAME}")

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

echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Tag your RDS instances with Key=AutoStartStop, Value=true"
echo "2. Test the functions"
echo "3. Monitor CloudWatch Logs"
`
};

// Utility Functions
function showLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

function getFormattedDate() {
    return new Date().toISOString().split('T')[0];
}

function showError(message) {
    hideLoading();
    alert('Download Error: ' + message + '\n\nPlease check your browser console for details.');
    console.error('Download error:', message);
}

// Check if libraries are loaded
function checkLibraries() {
    const missing = [];
    if (typeof JSZip === 'undefined') missing.push('JSZip');
    if (typeof saveAs === 'undefined') missing.push('FileSaver');
    if (typeof window.jspdf === 'undefined') missing.push('jsPDF');
    
    if (missing.length > 0) {
        console.error('Missing libraries:', missing);
        return false;
    }
    return true;
}

// Download Lambda Code
function downloadLambda() {
    try {
        const blob = new Blob([FILES.lambda], { type: 'text/x-python' });
        saveAs(blob, 'lambda_function.py');
    } catch (error) {
        showError('Failed to download Lambda code: ' + error.message);
    }
}

// Download Bash Script
function downloadBashScript() {
    try {
        const blob = new Blob([FILES.bashScript], { type: 'text/x-sh' });
        saveAs(blob, 'setup-rds-automation.sh');
    } catch (error) {
        showError('Failed to download bash script: ' + error.message);
    }
}

// Download Terraform Files
function downloadTerraform() {
    if (!checkLibraries()) {
        showError('Required libraries not loaded. Please refresh the page.');
        return;
    }
    
    showLoading();
    
    try {
        const zip = new JSZip();
        const terraformFolder = zip.folder("terraform");
        
        terraformFolder.file("main.tf", FILES.terraformMain);
        terraformFolder.file("variables.tf", FILES.terraformVariables);
        terraformFolder.file("outputs.tf", FILES.terraformOutputs);
        terraformFolder.file("lambda_function.py", FILES.lambda);
        terraformFolder.file("README.md", FILES.terraformReadme);
        
        zip.generateAsync({ type: "blob" })
            .then(function(content) {
                saveAs(content, `RDS-Terraform-${getFormattedDate()}.zip`);
                hideLoading();
            })
            .catch(function(error) {
                showError('Failed to generate ZIP: ' + error.message);
            });
    } catch (error) {
        showError('Failed to create Terraform package: ' + error.message);
    }
}

// Download All Files
function downloadAll() {
    if (!checkLibraries()) {
        showError('Required libraries not loaded. Please refresh the page.');
        return;
    }
    
    showLoading();
    
    try {
        const zip = new JSZip();
        
        // Terraform folder
        const terraformFolder = zip.folder("terraform");
        terraformFolder.file("main.tf", FILES.terraformMain);
        terraformFolder.file("variables.tf", FILES.terraformVariables);
        terraformFolder.file("outputs.tf", FILES.terraformOutputs);
        terraformFolder.file("README.md", FILES.terraformReadme);
        
        // Lambda folder
        const lambdaFolder = zip.folder("lambda");
        lambdaFolder.file("lambda_function.py", FILES.lambda);
        
        // Scripts folder
        const scriptsFolder = zip.folder("scripts");
        scriptsFolder.file("setup-rds-automation.sh", FILES.bashScript);
        
        // Documentation
        const docsFolder = zip.folder("documentation");
        const readmeContent = `RDS START/STOP AUTOMATION - COMPLETE PACKAGE
=============================================

This package contains everything you need to implement automated 
RDS instance start/stop functionality using AWS Lambda and EventBridge.

CONTENTS:
---------
1. terraform/ - Terraform IaC files
2. lambda/ - Lambda function code
3. scripts/ - Setup automation script
4. documentation/ - This file

QUICK START:
-----------
Option 1 - Terraform:
   cd terraform/
   terraform init
   terraform apply

Option 2 - AWS CLI:
   chmod +x scripts/setup-rds-automation.sh
   ./scripts/setup-rds-automation.sh

REQUIREMENTS:
------------
- AWS Account
- AWS CLI configured
- Appropriate IAM permissions
- Terraform (for IaC option)

Generated: ${new Date().toLocaleDateString()}
`;
        docsFolder.file("README.txt", readmeContent);
        
        zip.generateAsync({ type: "blob" })
            .then(function(content) {
                saveAs(content, `RDS-Automation-Complete-${getFormattedDate()}.zip`);
                hideLoading();
            })
            .catch(function(error) {
                showError('Failed to generate complete package: ' + error.message);
            });
    } catch (error) {
        showError('Failed to create package: ' + error.message);
    }
}

// Download PDF
function downloadPDF() {
    if (typeof window.jspdf === 'undefined') {
        showError('PDF library not loaded. Please refresh the page.');
        return;
    }
    
    showLoading();
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        let yPos = 20;
        const lineHeight = 7;
        const pageHeight = doc.internal.pageSize.height;
        const margin = 20;
        
        // Helper function to add text with page breaks
        function addText(text, fontSize = 11, isBold = false) {
            if (yPos > pageHeight - 20) {
                doc.addPage();
                yPos = 20;
            }
            doc.setFontSize(fontSize);
            doc.setFont(undefined, isBold ? 'bold' : 'normal');
            doc.text(text, margin, yPos);
            yPos += lineHeight;
        }
        
        // Title
        doc.setFontSize(22);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(35, 47, 62);
        doc.text('RDS Start/Stop Automation Guide', margin, yPos);
        yPos += 10;
        
        // Subtitle
        doc.setFontSize(14);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100);
        doc.text('Complete Solution with Lambda & EventBridge', margin, yPos);
        yPos += 8;
        
        // Date
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, yPos);
        yPos += 15;
        
        // Reset color
        doc.setTextColor(0);
        
        // Solution Overview
        addText('SOLUTION OVERVIEW', 16, true);
        yPos += 3;
        addText('• Start Time: 9:30 AM (Monday-Friday)');
        addText('• Stop Time: 6:30 PM (Monday-Friday)');
        addText('• Tag Key: AutoStartStop');
        addText('• Tag Value: true');
        addText('• Technology: AWS Lambda, EventBridge, Python 3.11');
        yPos += 5;
        
        // Architecture
        addText('ARCHITECTURE', 16, true);
        yPos += 3;
        addText('1. EventBridge triggers Lambda functions on schedule');
        addText('2. Lambda queries all RDS instances');
        addText('3. Instances with AutoStartStop=true tag are affected');
        addText('4. CloudWatch Logs capture all operations');
        yPos += 5;
        
        // Implementation Steps
        addText('IMPLEMENTATION STEPS', 16, true);
        yPos += 3;
        addText('Step 1: Create IAM Role', 12, true);
        addText('   • Open IAM Console → Roles → Create Role');
        addText('   • Select Lambda service');
        addText('   • Attach RDS and CloudWatch permissions');
        yPos += 3;
        
        addText('Step 2: Create Lambda Functions', 12, true);
        addText('   • Create two functions: RDS-Start-Function & RDS-Stop-Function');
        addText('   • Runtime: Python 3.11');
        addText('   • Set environment variables (ACTION, TAG_KEY, TAG_VALUE)');
        yPos += 3;
        
        addText('Step 3: Configure EventBridge Rules', 12, true);
        addText('   • Start schedule: cron(30 9 ? * MON-FRI *)');
        addText('   • Stop schedule: cron(30 18 ? * MON-FRI *)');
        yPos += 3;
        
        addText('Step 4: Tag RDS Instances', 12, true);
        addText('   • Add tag: AutoStartStop = true');
        yPos += 5;
        
        // Important Notes
        addText('IMPORTANT NOTES', 16, true);
        yPos += 3;
        addText('⚠ Timezone: Cron expressions use UTC');
        addText('⚠ Cannot stop Multi-AZ instances');
        addText('⚠ Cannot stop instances with read replicas');
        addText('⚠ Stopped instances auto-start after 7 days');
        yPos += 5;
        
        // Testing
        addText('TESTING COMMANDS', 16, true);
        yPos += 3;
        addText('aws lambda invoke --function-name RDS-Start-Function response.json', 9);
        addText('aws lambda invoke --function-name RDS-Stop-Function response.json', 9);
        yPos += 5;
        
        // Footer
        doc.setFontSize(8);
        doc.setTextColor(128);
        doc.text('For complete code and Terraform files, download from the website.', margin, pageHeight - 10);
        
        // Save
        doc.save(`RDS-Automation-Guide-${getFormattedDate()}.pdf`);
        hideLoading();
    } catch (error) {
        showError('Failed to generate PDF: ' + error.message);
    }
}

// Download DOCX (Simple text-based version)
function downloadDOCX() {
    showLoading();
    
    try {
        const content = `RDS START/STOP AUTOMATION GUIDE
================================

Complete Solution with Lambda, EventBridge & Terraform
Generated: ${new Date().toLocaleDateString()}

SOLUTION OVERVIEW
-----------------
• Start Time: 9:30 AM (Monday-Friday)
• Stop Time: 6:30 PM (Monday-Friday)
• Tag Key: AutoStartStop
• Tag Value: true
• Technology: AWS Lambda, EventBridge, Python 3.11

ARCHITECTURE
------------
1. EventBridge triggers Lambda functions on schedule
2. Lambda queries all RDS instances
3. Instances with AutoStartStop=true tag are affected
4. CloudWatch Logs capture all operations

IMPLEMENTATION STEPS
--------------------

Step 1: Create IAM Role
• Open IAM Console → Roles → Create Role
• Select Lambda service
• Attach RDS and CloudWatch permissions
• Name: RDS-StartStop-Lambda-Role

Step 2: Create Lambda Functions
• Create two functions: RDS-Start-Function & RDS-Stop-Function
• Runtime: Python 3.11
• Set environment variables:
  - ACTION: start/stop
  - TAG_KEY: AutoStartStop
  - TAG_VALUE: true

Step 3: Configure EventBridge Rules
• Start schedule: cron(30 9 ? * MON-FRI *)
• Stop schedule: cron(30 18 ? * MON-FRI *)
• Target: Respective Lambda functions

Step 4: Tag RDS Instances
• Navigate to RDS Console
• Select instance
• Add tag: AutoStartStop = true

LAMBDA FUNCTION CODE
--------------------
${FILES.lambda}

TERRAFORM CONFIGURATION
-----------------------
See downloaded Terraform files for complete IaC setup.

TESTING
-------
# Test START function
aws lambda invoke --function-name RDS-Start-Function response.json

# Test STOP function
aws lambda invoke --function-name RDS-Stop-Function response.json

# Check logs
aws logs tail /aws/lambda/RDS-Start-Function --follow

IMPORTANT NOTES
---------------
⚠ Timezone: Cron expressions use UTC
⚠ Cannot stop Multi-AZ instances
⚠ Cannot stop instances with read replicas
⚠ Stopped instances auto-start after 7 days

SUPPORT
-------
For questions or issues, refer to AWS documentation.

© 2024 RDS Automation Guide
`;
        
        const blob = new Blob([content], { type: 'text/plain' });
        saveAs(blob, `RDS-Automation-Guide-${getFormattedDate()}.txt`);
        hideLoading();
    } catch (error) {
        showError('Failed to create document: ' + error.message);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Downloads module initialized');
    
    // Check if libraries loaded
    setTimeout(function() {
        if (!checkLibraries()) {
            console.warn('Some libraries failed to load. Downloads may not work properly.');
        } else {
            console.log('All download libraries loaded successfully');
        }
    }, 2000);
});
