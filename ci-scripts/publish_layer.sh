#!/bin/bash

set -euo pipefail

for region in ${REGIONS[@]}; do
    if [ "$LIMITED_REGION" = true ] ; then
        output=`aws lambda publish-layer-version --layer-name ${LAYER_NAME}${NAME_SUFFIX} --compatible-runtimes $COMPATIBLE_RUNTIMES --zip-file fileb://target/layer.zip --region $region`
    else 
        output=`aws lambda publish-layer-version --layer-name ${LAYER_NAME}${NAME_SUFFIX} --compatible-architectures x86_64 arm64 --compatible-runtimes $COMPATIBLE_RUNTIMES --zip-file fileb://target/layer.zip --region $region`
    fi
    version=`echo "$output" | jq -r .Version` 
    versionArn=`echo "$output" | jq -r .LayerVersionArn`
    if [ "$PUBLIC" = true ] ; then
        aws lambda add-layer-version-permission --layer-name ${LAYER_NAME}${NAME_SUFFIX} --principal '*' --action lambda:GetLayerVersion --version-number $version --statement-id public --region $region > /dev/null
    fi
    echo $versionArn
done