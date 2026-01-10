"""
VerifyAuthChallenge Lambda Trigger
Verifies the OTP entered by the user matches the generated OTP.
"""
import json

def handler(event, context):
    print(f"VerifyAuthChallenge event: {json.dumps(event)}")
    
    # Get expected answer from private challenge parameters
    expected_answer = event['request']['privateChallengeParameters'].get('answer', '')
    
    # Get user's answer
    user_answer = event['request']['challengeAnswer']
    
    # Compare
    if expected_answer and user_answer == expected_answer:
        event['response']['answerCorrect'] = True
        print("OTP verification successful")
    else:
        event['response']['answerCorrect'] = False
        print(f"OTP verification failed. Expected: {expected_answer}, Got: {user_answer}")
    
    return event
