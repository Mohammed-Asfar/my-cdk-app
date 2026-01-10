"""
Admin Handler Lambda
Provides admin operations for user management, role management, and history access.
"""
import json
import os
import boto3
from decimal import Decimal

cognito = boto3.client('cognito-idp')
dynamodb = boto3.resource('dynamodb')

USER_POOL_ID = os.environ.get('USER_POOL_ID')
ROLES_TABLE = os.environ.get('ROLES_TABLE')
HISTORY_TABLE = os.environ.get('HISTORY_TABLE')

# Helper for JSON serialization of Decimal
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)

def response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
        },
        'body': json.dumps(body, cls=DecimalEncoder)
    }

def check_admin(event):
    """Check if the caller is an admin"""
    try:
        claims = event['requestContext']['authorizer']['claims']
        groups = claims.get('cognito:groups', '')
        if isinstance(groups, str):
            groups = groups.split(',') if groups else []
        return 'AdminRole' in groups
    except:
        return False

def handler(event, context):
    print(f"Admin handler event: {json.dumps(event)}")
    
    # Verify admin access
    if not check_admin(event):
        return response(403, {'error': 'Admin access required'})
    
    http_method = event['httpMethod']
    path = event['path']
    
    try:
        # User Management
        if path == '/admin/users' and http_method == 'GET':
            return list_users()
        elif path == '/admin/users/role' and http_method == 'POST':
            body = json.loads(event['body'])
            return update_user_role(body['username'], body['role'])
        elif path == '/admin/users/block' and http_method == 'POST':
            body = json.loads(event['body'])
            return block_user(body['username'], body['block'])
        elif path == '/admin/users' and http_method == 'DELETE':
            body = json.loads(event['body'])
            return delete_user(body['username'])
        
        # Role Management
        elif path == '/admin/roles' and http_method == 'GET':
            return list_roles()
        elif path == '/admin/roles' and http_method == 'POST':
            body = json.loads(event['body'])
            return create_role(body['roleName'], body.get('permissions', []))
        elif path == '/admin/roles' and http_method == 'DELETE':
            body = json.loads(event['body'])
            return delete_role(body['roleName'])
        
        # History Management
        elif path == '/admin/history' and http_method == 'GET':
            return get_all_history()
        elif path == '/admin/history' and http_method == 'DELETE':
            body = json.loads(event['body'])
            return delete_history(body['userId'], body['timestamp'])
        
        else:
            return response(404, {'error': 'Not found'})
    
    except Exception as e:
        print(f"Error: {e}")
        return response(500, {'error': str(e)})

# ==========================================
# User Management Functions
# ==========================================

def list_users():
    """List all users in the user pool"""
    result = cognito.list_users(UserPoolId=USER_POOL_ID, Limit=60)
    
    users = []
    for user in result.get('Users', []):
        # Get user groups
        groups_result = cognito.admin_list_groups_for_user(
            Username=user['Username'],
            UserPoolId=USER_POOL_ID
        )
        groups = [g['GroupName'] for g in groups_result.get('Groups', [])]
        
        # Get user attributes
        attrs = {attr['Name']: attr['Value'] for attr in user.get('Attributes', [])}
        
        users.append({
            'username': user['Username'],
            'email': attrs.get('email', ''),
            'phone': attrs.get('phone_number', ''),
            'role': attrs.get('custom:role', ''),
            'groups': groups,
            'enabled': user['Enabled'],
            'status': user['UserStatus'],
            'created': user['UserCreateDate'].isoformat()
        })
    
    return response(200, {'users': users})

def update_user_role(username, new_role):
    """Update a user's role (change group membership)"""
    # Get current groups
    groups_result = cognito.admin_list_groups_for_user(
        Username=username,
        UserPoolId=USER_POOL_ID
    )
    current_groups = [g['GroupName'] for g in groups_result.get('Groups', [])]
    
    # Remove from current role groups (not AdminRole)
    for group in current_groups:
        if group != 'AdminRole':
            try:
                cognito.admin_remove_user_from_group(
                    UserPoolId=USER_POOL_ID,
                    Username=username,
                    GroupName=group
                )
            except:
                pass
    
    # Add to new role group
    cognito.admin_add_user_to_group(
        UserPoolId=USER_POOL_ID,
        Username=username,
        GroupName=new_role
    )
    
    # Update custom:role attribute
    cognito.admin_update_user_attributes(
        UserPoolId=USER_POOL_ID,
        Username=username,
        UserAttributes=[{'Name': 'custom:role', 'Value': new_role}]
    )
    
    return response(200, {'message': f'Role updated to {new_role}'})

def block_user(username, block):
    """Enable or disable a user"""
    if block:
        cognito.admin_disable_user(UserPoolId=USER_POOL_ID, Username=username)
    else:
        cognito.admin_enable_user(UserPoolId=USER_POOL_ID, Username=username)
    
    return response(200, {'message': f'User {"blocked" if block else "unblocked"}'})

def delete_user(username):
    """Delete a user from the user pool"""
    cognito.admin_delete_user(UserPoolId=USER_POOL_ID, Username=username)
    return response(200, {'message': 'User deleted'})

# ==========================================
# Role Management Functions
# ==========================================

def list_roles():
    """List all custom roles from DynamoDB"""
    table = dynamodb.Table(ROLES_TABLE)
    result = table.scan()
    
    roles = result.get('Items', [])
    
    # Add default roles
    default_roles = [
        {'roleName': 'ASrole', 'permissions': ['add', 'subtract'], 'isDefault': True},
        {'roleName': 'DMrole', 'permissions': ['divide', 'multiply'], 'isDefault': True}
    ]
    
    return response(200, {'roles': default_roles + roles})

def create_role(role_name, permissions):
    """Create a new custom role"""
    table = dynamodb.Table(ROLES_TABLE)
    
    # Create role in DynamoDB
    table.put_item(Item={
        'roleName': role_name,
        'permissions': permissions,
        'isDefault': False
    })
    
    # Create corresponding Cognito group
    try:
        cognito.create_group(
            GroupName=role_name,
            UserPoolId=USER_POOL_ID,
            Description=f'Custom role: {role_name}'
        )
    except cognito.exceptions.GroupExistsException:
        pass
    
    return response(200, {'message': f'Role {role_name} created'})

def delete_role(role_name):
    """Delete a custom role"""
    # Prevent deleting default roles
    if role_name in ['ASrole', 'DMrole', 'AdminRole']:
        return response(400, {'error': 'Cannot delete default roles'})
    
    table = dynamodb.Table(ROLES_TABLE)
    table.delete_item(Key={'roleName': role_name})
    
    # Delete Cognito group
    try:
        cognito.delete_group(GroupName=role_name, UserPoolId=USER_POOL_ID)
    except:
        pass
    
    return response(200, {'message': f'Role {role_name} deleted'})

# ==========================================
# History Management Functions
# ==========================================

def get_all_history():
    """Get calculation history for all users"""
    table = dynamodb.Table(HISTORY_TABLE)
    result = table.scan()
    
    return response(200, {'history': result.get('Items', [])})

def delete_history(user_id, timestamp):
    """Delete a specific history entry"""
    table = dynamodb.Table(HISTORY_TABLE)
    table.delete_item(Key={'userId': user_id, 'timestamp': timestamp})
    
    return response(200, {'message': 'History entry deleted'})
