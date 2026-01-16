import { useState, useCallback, useRef } from "react";

/**
 * Custom hook for optimistic updates
 * Provides state management with rollback capability
 * @param {any} initialData - Initial data state
 * @returns {object} { data, setData, optimisticUpdate, rollback, isPending }
 */
export function useOptimistic(initialData = null) {
    const [data, setData] = useState(initialData);
    const [isPending, setIsPending] = useState(false);
    const previousDataRef = useRef(null);
    const rollbackTimeoutRef = useRef(null);

    /**
   * Perform an optimistic update
   * @param {Function} updateFn - Function that returns the new data (receives current data)
   * @param {Function} asyncAction - Async function to perform (API call)
   * @param {object} options - Options
   * @param {number} options.rollbackDelay - Delay before auto-rollback on error (ms)
   * @returns {Promise<any>} Result of the async action
   */
    const optimisticUpdate = useCallback(async (updateFn, asyncAction, options = {}) => {
        const { rollbackDelay = 0 } = options;

        // Store current data for potential rollback
        previousDataRef.current = data;
        setIsPending(true);

        // Apply optimistic update immediately
        const optimisticData = updateFn(data);
        setData(optimisticData);

        try {
            // Perform actual async action
            const result = await asyncAction();
            setIsPending(false);
            return result;
        } catch (error) {
            // Rollback on error
            if (rollbackDelay > 0) {
                rollbackTimeoutRef.current = setTimeout(() => {
                    setData(previousDataRef.current);
                }, rollbackDelay);
            } else {
                setData(previousDataRef.current);
            }
            setIsPending(false);
            throw error;
        }
    }, [data]);

    /**
   * Manually rollback to previous state
   */
    const rollback = useCallback(() => {
        if (previousDataRef.current !== null) {
            setData(previousDataRef.current);
        }
    }, []);

    /**
   * Clear any pending rollback
   */
    const clearRollback = useCallback(() => {
        if (rollbackTimeoutRef.current) {
            clearTimeout(rollbackTimeoutRef.current);
            rollbackTimeoutRef.current = null;
        }
    }, []);

    return {
        data,
        setData,
        optimisticUpdate,
        rollback,
        clearRollback,
        isPending
    };
}

/**
 * Helper function to create an optimistic delete update
 * @param {Array} items - Current items array
 * @param {string} id - ID of item to remove
 * @returns {Array} New array without the deleted item
 */
export function optimisticDelete(items, id) {
    if (!Array.isArray(items)) return items;
    return items.filter(item => item.id !== id);
}

/**
 * Helper function to create an optimistic bulk delete update
 * @param {Array} items - Current items array
 * @param {Array<string>} ids - IDs of items to remove
 * @returns {Array} New array without the deleted items
 */
export function optimisticBulkDelete(items, ids) {
    if (!Array.isArray(items)) return items;
    const idSet = new Set(ids);
    return items.filter(item => !idSet.has(item.id));
}

/**
 * Helper function to create an optimistic status update
 * @param {Array} items - Current items array
 * @param {string} id - ID of item to update
 * @param {string} newStatus - New status value
 * @returns {Array} New array with updated item
 */
export function optimisticStatusUpdate(items, id, newStatus) {
    if (!Array.isArray(items)) return items;
    return items.map(item =>
        item.id === id ? { ...item, status: newStatus } : item
    );
}

/**
 * Helper function to create an optimistic item update
 * @param {Array} items - Current items array
 * @param {string} id - ID of item to update
 * @param {object} updates - Updates to apply
 * @returns {Array} New array with updated item
 */
export function optimisticItemUpdate(items, id, updates) {
    if (!Array.isArray(items)) return items;
    return items.map(item =>
        item.id === id ? { ...item, ...updates } : item
    );
}

export default useOptimistic;
