import json
import boto3
import os
from decimal import Decimal
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['HISTORY_TABLE'])
roles_table = dynamodb.Table(os.environ['ROLES_TABLE'])

# Default role permissions (fallback)
DEFAULT_ROLE_PERMISSIONS = {
    'DMrole': ['divide', 'multiply'],
    'ASrole': ['add', 'subtract'],
    'AdminRole': ['add', 'subtract', 'divide', 'multiply']
}

def get_role_permissions():
    """Load role permissions from DynamoDB, merge with defaults."""
    permissions = DEFAULT_ROLE_PERMISSIONS.copy()
    
    try:
        # Scan RolesTable for custom roles
        result = roles_table.scan()
        for item in result.get('Items', []):
            role_name = item.get('roleName')
            role_perms = item.get('permissions', [])
            if role_name and role_perms:
                permissions[role_name] = role_perms
    except Exception as e:
        print(f"Could not load custom roles: {e}")
    
    return permissions


def handler(event, context):
    """
    Calculator Lambda handler with Role-Based Access Control.
    - Loads permissions from RolesTable DynamoDB
    - Supports custom roles
    """
    try:
        # Load role permissions (includes custom roles)
        role_permissions = get_role_permissions()
        
        # Get user info from Cognito authorizer
        claims = event['requestContext']['authorizer']['claims']
        user_id = claims['sub']
        
        # Get user's groups (roles) from the token
        # Groups come as a string like "[DMrole]" or "[DMrole, ASrole]"
        groups_claim = claims.get('cognito:groups', '[]')
        if isinstance(groups_claim, str):
            # Parse the groups string
            groups = [g.strip() for g in groups_claim.strip('[]').split(',') if g.strip()]
        else:
            groups = groups_claim if groups_claim else []
        
        # Parse request body
        body = json.loads(event['body'])
        operand1 = Decimal(str(body['operand1']))
        operand2 = Decimal(str(body['operand2']))
        operation = body['operation']
        
        # 🔒 Role-Based Access Control Check
        allowed = False
        required_role = None
        
        # Check all roles the user has for this operation
        for user_role in groups:
            if user_role in role_permissions:
                if operation in role_permissions[user_role]:
                    allowed = True
                    required_role = user_role
                    break
        
        # If not allowed, find what role IS needed
        if not allowed:
            for role, allowed_ops in role_permissions.items():
                if operation in allowed_ops:
                    required_role = role
                    break
            
            return response(403, {
                'error': f'Access Denied: You need a role with "{operation}" permission.',
                'your_roles': groups,
                'required_role': required_role or 'Unknown'
            })
        
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
            'result': result,
            'role_used': required_role
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
            'history': history,
            'user_roles': groups
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
