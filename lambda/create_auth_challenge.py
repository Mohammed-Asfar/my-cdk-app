"""
CreateAuthChallenge Lambda Trigger
Generates OTP and sends it via SMS using SNS.
"""
import json
import os
import random
import boto3

sns = boto3.client('sns')

def handler(event, context):
    print(f"CreateAuthChallenge event: {json.dumps(event)}")
    
    if event['request']['challengeName'] == 'CUSTOM_CHALLENGE':
        # Generate 6-digit OTP
        otp = str(random.randint(100000, 999999))
        
        # Get user's phone number
        phone_number = None
        for attr in event['request']['userAttributes'].get('phone_number', []):
            phone_number = attr
            break
        
        # If phone_number is a string (not list), use it directly
        if isinstance(event['request']['userAttributes'].get('phone_number'), str):
            phone_number = event['request']['userAttributes']['phone_number']
        
        if phone_number:
            try:
                # Send OTP via SMS
                sns.publish(
                    PhoneNumber=phone_number,
                    Message=f'Your Calculator App login OTP is: {otp}. Valid for 5 minutes.',
                    MessageAttributes={
                        'AWS.SNS.SMS.SMSType': {
                            'DataType': 'String',
                            'StringValue': 'Transactional'
                        }
                    }
                )
                print(f"OTP sent to {phone_number}")
            except Exception as e:
                print(f"Failed to send SMS: {e}")
                # Continue anyway - OTP will be in logs for testing
        
        # Store OTP in private challenge parameters (not visible to client)
        event['response']['privateChallengeParameters'] = {
            'answer': otp
        }
        
        # Public challenge parameters (visible to client)
        event['response']['publicChallengeParameters'] = {
            'phone': phone_number[-4:] if phone_number else '****'  # Last 4 digits only
        }
        
        # Challenge metadata
        event['response']['challengeMetadata'] = 'OTP_CHALLENGE'
    
    print(f"CreateAuthChallenge response: {json.dumps(event['response'])}")
    return event
