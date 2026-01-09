import json
import boto3
import os

cognito = boto3.client('cognito-idp')

def handler(event, context):
    """
    Post Confirmation Lambda Trigger - Adds user to their selected role group.
    """
    try:
        user_pool_id = event['userPoolId']
        username = event['userName']
        
        # Get the selected role from custom attribute
        user_attributes = event['request'].get('userAttributes', {})
        selected_role = user_attributes.get('custom:role', 'ASrole')  # Default to ASrole
        
        # Validate role
        valid_roles = ['DMrole', 'ASrole']
        if selected_role not in valid_roles:
            selected_role = 'ASrole'
        
        # Add user to the selected group
        cognito.admin_add_user_to_group(
            UserPoolId=user_pool_id,
            Username=username,
            GroupName=selected_role
        )
        
        print(f"Added user {username} to group {selected_role}")
        
    except Exception as e:
        print(f"Error adding user to group: {e}")
        # Don't fail the confirmation, just log the error
    
    return event
