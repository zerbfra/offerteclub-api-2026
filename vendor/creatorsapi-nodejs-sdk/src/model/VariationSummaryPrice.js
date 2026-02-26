/**
 * Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import ApiClient from '../ApiClient';
import Money from './Money';

/**
 * The VariationSummaryPrice model module.
 * @module model/VariationSummaryPrice
 * @version 1.0.0
 */
class VariationSummaryPrice {
    /**
     * Constructs a new <code>VariationSummaryPrice</code>.
     * The container for highest and lowest price for variations.
     * @alias module:model/VariationSummaryPrice
     */
    constructor() { 
        
        VariationSummaryPrice.initialize(this);
    }

    /**
     * Initializes the fields of this object.
     * This method is used by the constructors of any subclasses, in order to implement multiple inheritance (mix-ins).
     * Only for internal use.
     */
    static initialize(obj) { 
    }

    /**
     * Constructs a <code>VariationSummaryPrice</code> from a plain JavaScript object, optionally creating a new instance.
     * Copies all relevant properties from <code>data</code> to <code>obj</code> if supplied or a new instance if not.
     * @param {Object} data The plain JavaScript object bearing properties of interest.
     * @param {module:model/VariationSummaryPrice} obj Optional instance to populate.
     * @return {module:model/VariationSummaryPrice} The populated <code>VariationSummaryPrice</code> instance.
     */
    static constructFromObject(data, obj) {
        if (data) {
            obj = obj || new VariationSummaryPrice();

            if (data.hasOwnProperty('highestPrice')) {
                obj['highestPrice'] = Money.constructFromObject(data['highestPrice']);
            }
            if (data.hasOwnProperty('lowestPrice')) {
                obj['lowestPrice'] = Money.constructFromObject(data['lowestPrice']);
            }
        }
        return obj;
    }

    /**
     * Validates the JSON data with respect to <code>VariationSummaryPrice</code>.
     * @param {Object} data The plain JavaScript object bearing properties of interest.
     * @return {boolean} to indicate whether the JSON data is valid with respect to <code>VariationSummaryPrice</code>.
     */
    static validateJSON(data) {
        // validate the optional field `highestPrice`
        if (data['highestPrice']) { // data not null
          Money.validateJSON(data['highestPrice']);
        }
        // validate the optional field `lowestPrice`
        if (data['lowestPrice']) { // data not null
          Money.validateJSON(data['lowestPrice']);
        }

        return true;
    }


}



/**
 * @member {module:model/Money} highestPrice
 */
VariationSummaryPrice.prototype['highestPrice'] = undefined;

/**
 * @member {module:model/Money} lowestPrice
 */
VariationSummaryPrice.prototype['lowestPrice'] = undefined;






export default VariationSummaryPrice;

