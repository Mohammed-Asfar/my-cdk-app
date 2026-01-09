from aws_cdk import (
    Stack,
    RemovalPolicy,
    CfnOutput,
    Duration,
    aws_cognito as cognito,
    aws_lambda as _lambda,
    aws_apigateway as apigw,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
)
from constructs import Construct


class MyCdkAppStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs):
        super().__init__(scope, construct_id, **kwargs)

        # 🔐 Cognito User Pool
        user_pool = cognito.UserPool(
            self,
            "UserPool",
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(username=True, email=True),
            password_policy=cognito.PasswordPolicy(
                min_length=8,
                require_digits=True,
                require_lowercase=True,
                require_uppercase=True,
                require_symbols=True,
            ),
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # 📱 User Pool Client (App client)
        user_pool_client = cognito.UserPoolClient(
            self,
            "UserPoolClient",
            user_pool=user_pool,
            auth_flows=cognito.AuthFlow(
                user_password=True,
                user_srp=True
            ),
            generate_secret=False
        )

        # 📊 DynamoDB Table for Calculator History
        history_table = dynamodb.Table(
            self,
            "CalculatorHistory",
            partition_key=dynamodb.Attribute(
                name="userId",
                type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="timestamp",
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ⚡ Lambda Function for Calculations
        calculate_lambda = _lambda.Function(
            self,
            "CalculateLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="calculate_handler.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(30),
            environment={
                "HISTORY_TABLE": history_table.table_name
            }
        )

        # Grant Lambda permissions to DynamoDB
        history_table.grant_read_write_data(calculate_lambda)

        # 🌐 API Gateway with Cognito Authorizer
        api = apigw.RestApi(
            self,
            "CalculatorApi",
            rest_api_name="Calculator API",
            description="API for calculator with Cognito authentication",
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=apigw.Cors.ALL_METHODS,
                allow_headers=["Content-Type", "Authorization"],
            )
        )

        # Cognito Authorizer
        authorizer = apigw.CognitoUserPoolsAuthorizer(
            self,
            "CognitoAuthorizer",
            cognito_user_pools=[user_pool]
        )

        # /calculate endpoint
        calculate_resource = api.root.add_resource("calculate")
        calculate_resource.add_method(
            "POST",
            apigw.LambdaIntegration(calculate_lambda),
            authorizer=authorizer,
            authorization_type=apigw.AuthorizationType.COGNITO,
        )

        # 📤 Outputs for frontend configuration
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
        CfnOutput(self, "ApiEndpoint", value=api.url)
        CfnOutput(self, "Region", value=self.region)
