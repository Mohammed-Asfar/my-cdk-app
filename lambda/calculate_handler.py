import json
import boto3
import os
from decimal import Decimal
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['HISTORY_TABLE'])


def handler(event, context):
    """
    Calculator Lambda handler - performs calculations and stores history.
    """
    try:
        # Get user ID from Cognito authorizer
        user_id = event['requestContext']['authorizer']['claims']['sub']
        
        # Parse request body
        body = json.loads(event['body'])
        operand1 = Decimal(str(body['operand1']))
        operand2 = Decimal(str(body['operand2']))
        operation = body['operation']
        
        # Perform calculation
        result = None
        if operation == 'add':
            result = operand1 + operand2
        elif operation == 'subtract':
            result = operand1 - operand2
        elif operation == 'multiply':
            result = operand1 * operand2
        elif operation == 'divide':
            if operand2 == 0:
                return response(400, {'error': 'Division by zero'})
            result = operand1 / operand2
        else:
            return response(400, {'error': f'Unknown operation: {operation}'})
        
        # Store in DynamoDB
        timestamp = datetime.utcnow().isoformat()
        item = {
            'userId': user_id,
            'timestamp': timestamp,
            'operand1': operand1,
            'operand2': operand2,
            'operation': operation,
            'result': result
        }
        table.put_item(Item=item)
        
        # Get recent history for this user
        history_response = table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('userId').eq(user_id),
            ScanIndexForward=False,
            Limit=10
        )
        
        history = []
        for record in history_response.get('Items', []):
            history.append({
                'operand1': str(record['operand1']),
                'operand2': str(record['operand2']),
                'operation': record['operation'],
                'result': str(record['result']),
                'timestamp': record['timestamp']
            })
        
        return response(200, {
            'result': str(result),
            'history': history
        })
        
    except KeyError as e:
        return response(400, {'error': f'Missing field: {str(e)}'})
    except json.JSONDecodeError:
        return response(400, {'error': 'Invalid JSON body'})
    except Exception as e:
        return response(500, {'error': str(e)})


def response(status_code, body):
    """Helper to create API Gateway response with CORS headers."""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'POST,OPTIONS'
        },
        'body': json.dumps(body)
    }
