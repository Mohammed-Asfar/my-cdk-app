"""
DefineAuthChallenge Lambda Trigger
Decides what authentication challenge to present to the user.
"""
import json

def handler(event, context):
    print(f"DefineAuthChallenge event: {json.dumps(event)}")
    
    session = event['request'].get('session', [])
    
    if len(session) == 0:
        # First call - issue custom challenge
        event['response']['issueTokens'] = False
        event['response']['failAuthentication'] = False
        event['response']['challengeName'] = 'CUSTOM_CHALLENGE'
    elif len(session) == 1 and session[0]['challengeName'] == 'CUSTOM_CHALLENGE':
        # Second call - check if challenge was answered correctly
        if session[0]['challengeResult'] == True:
            # OTP verified successfully - issue tokens
            event['response']['issueTokens'] = True
            event['response']['failAuthentication'] = False
        else:
            # OTP verification failed
            event['response']['issueTokens'] = False
            event['response']['failAuthentication'] = True
    else:
        # Too many attempts
        event['response']['issueTokens'] = False
        event['response']['failAuthentication'] = True
    
    print(f"DefineAuthChallenge response: {json.dumps(event['response'])}")
    return event
