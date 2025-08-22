local isSitting = false

RegisterCommand("sit", function()
    if isSitting then return end

    local ped = PlayerPedId()
    if not IsPedInAnyVehicle(ped, false) and IsPedOnFoot(ped) then
        TaskStartScenarioInPlace(ped, "WORLD_HUMAN_PICNIC", 0, true)
        isSitting = true
        TriggerEvent("chat:addMessage", {
            color = {100, 200, 255},
            args = {"Server", "You're now sitting. Type /stand to get up."}
        })
    else
        TriggerEvent("chat:addMessage", {
            color = {255, 0, 0},
            args = {"Error", "You must be on foot and out of a vehicle to sit."}
        })
    end
end, false)

RegisterCommand("stand", function()
    local ped = PlayerPedId()
    if isSitting then
        ClearPedTasks(ped)
        isSitting = false
        TriggerEvent("chat:addMessage", {
            color = {100, 255, 100},
            args = {"Server", "You're now standing."}
        })
    end
end, false)
